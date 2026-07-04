"""PostgREST 호환 최소 shim — 소멸한 Supabase REST를 동일 오리진에서 대체한다.

프런트(supabase-data.js, Chatbot.js)가 생성하는 GET 쿼리 문법의 실사용 부분집합을
구현한다: select 프로젝션, eq/neq/gt/gte/lt/lte/like/ilike/is/in + not. 접두,
동일 컬럼 다중 필터(AND), or=(...), order(다중·방향), limit/offset.
미지원 문법은 PostgREST처럼 400 JSON으로 응답한다 (프런트 catch가 처리).
"""
import re

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from backend.local_data import get_tables

router = APIRouter()

_RESERVED = {"select", "order", "limit", "offset", "or", "and"}
_OPS = {"eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "in"}


class ShimError(Exception):
    def __init__(self, message: str, status: int = 400):
        self.message = message
        self.status = status


def _parse_scalar(raw: str):
    if raw.lower() == "null":
        return None
    if raw.lower() == "true":
        return True
    if raw.lower() == "false":
        return False
    try:
        return int(raw)
    except ValueError:
        pass
    try:
        return float(raw)
    except ValueError:
        return raw.strip('"')


def _as_number(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        try:
            return float(v)
        except ValueError:
            return None
    return None


def _compare(actual, target):
    """-1/0/1 비교. 숫자끼리는 수치, 그 외 문자열 비교. 비교 불가면 None."""
    an, tn = _as_number(actual), _as_number(target)
    if an is not None and tn is not None:
        return (an > tn) - (an < tn)
    if actual is None or target is None:
        return None
    a, t = str(actual), str(target)
    return (a > t) - (a < t)


def _like_match(actual, pattern: str, case_insensitive: bool) -> bool:
    if actual is None:
        return False
    pat = pattern.strip('"').replace("*", "%")
    regex = "^" + "".join(".*" if ch == "%" else "." if ch == "_" else re.escape(ch) for ch in pat) + "$"
    flags = re.IGNORECASE if case_insensitive else 0
    return re.match(regex, str(actual), flags) is not None


def _apply_op(actual, op: str, raw_value: str) -> bool:
    if op == "is":
        v = raw_value.lower()
        if v == "null":
            return actual is None
        if v == "true":
            return actual is True
        if v == "false":
            return actual is False
        raise ShimError(f"invalid input for is: {raw_value}")
    if op == "in":
        items = [_parse_scalar(x.strip()) for x in raw_value.strip("()").split(",") if x.strip() != ""]
        return any(_matches_eq(actual, it) for it in items)
    if op == "like":
        return _like_match(actual, raw_value, case_insensitive=False)
    if op == "ilike":
        return _like_match(actual, raw_value, case_insensitive=True)

    target = _parse_scalar(raw_value)
    if op == "eq":
        return _matches_eq(actual, target)
    if op == "neq":
        return not _matches_eq(actual, target)
    cmp = _compare(actual, target)
    if cmp is None:
        return False
    if op == "gt":
        return cmp > 0
    if op == "gte":
        return cmp >= 0
    if op == "lt":
        return cmp < 0
    if op == "lte":
        return cmp <= 0
    raise ShimError(f"unknown operator: {op}")


def _matches_eq(actual, target) -> bool:
    if actual is None or target is None:
        return actual is None and target is None
    if isinstance(target, bool) or isinstance(actual, bool):
        return actual is target or str(actual).lower() == str(target).lower()
    an, tn = _as_number(actual), _as_number(target)
    if an is not None and tn is not None:
        return an == tn
    return str(actual) == str(target)


def _parse_condition(expr: str):
    """'op.value' 또는 'not.op.value' → (negated, op, raw_value)"""
    negated = False
    rest = expr
    if rest.startswith("not."):
        negated, rest = True, rest[4:]
    head, sep, value = rest.partition(".")
    if not sep or head not in _OPS:
        raise ShimError(f"unsupported filter: {expr}")
    return negated, head, value


def _row_passes_filter(row: dict, col: str, expr: str) -> bool:
    negated, op, value = _parse_condition(expr)
    result = _apply_op(row.get(col), op, value)
    return (not result) if negated else result


def _row_passes_or(row: dict, group: str) -> bool:
    inner = group.strip()
    if inner.startswith("(") and inner.endswith(")"):
        inner = inner[1:-1]
    conditions = [c.strip() for c in inner.split(",") if c.strip()]
    if not conditions:
        raise ShimError("empty or= group")
    for cond in conditions:
        col, sep, expr = cond.partition(".")
        if not sep:
            raise ShimError(f"unsupported or condition: {cond}")
        if _row_passes_filter(row, col, expr):
            return True
    return False


def _sort_rows(rows: list[dict], order_expr: str) -> list[dict]:
    for term in reversed([t.strip() for t in order_expr.split(",") if t.strip()]):
        parts = term.split(".")
        col = parts[0]
        desc = "desc" in parts[1:]

        def key(row, c=col, d=desc):
            v = row.get(c)
            # PostgREST 기본: null은 최대값 취급 (asc→마지막, desc→처음)
            if v is None:
                return (1, 0)
            n = _as_number(v)
            if n is not None:
                return (0, (-n if d else n))
            s = str(v)
            if d:
                s = tuple(-ord(ch) for ch in s)
            return (0, s)

        try:
            rows = sorted(rows, key=key)
        except TypeError:
            rows = sorted(rows, key=lambda r, c=col: (r.get(c) is None, str(r.get(c))),
                          reverse=desc)
    return rows


@router.get("/rest/v1/{table}")
async def query_table(table: str, request: Request):
    tables = get_tables()
    if table not in tables:
        return JSONResponse(status_code=404,
                            content={"message": f'relation "public.{table}" does not exist'})
    rows = list(tables[table])

    select = "*"
    order_expr = None
    limit = None
    offset = 0
    try:
        for key, value in request.query_params.multi_items():
            if key == "select":
                select = value
            elif key == "order":
                order_expr = value
            elif key == "limit":
                limit = int(value)
            elif key == "offset":
                offset = int(value)
            elif key == "or":
                rows = [r for r in rows if _row_passes_or(r, value)]
            elif key == "and" or key in _RESERVED:
                raise ShimError(f"unsupported parameter: {key}")
            elif key in ("apikey",):
                continue
            else:
                rows = [r for r in rows if _row_passes_filter(r, key, value)]

        if order_expr:
            rows = _sort_rows(rows, order_expr)
        if offset:
            rows = rows[offset:]
        if limit is not None:
            rows = rows[:limit]

        if select.strip() == "*":
            return JSONResponse(content=rows)
        cols = [c.strip().strip('"') for c in select.split(",") if c.strip()]
        return JSONResponse(content=[{c: r.get(c) for c in cols} for r in rows])
    except ShimError as e:
        return JSONResponse(status_code=e.status, content={"message": e.message})
    except (ValueError, TypeError) as e:
        return JSONResponse(status_code=400, content={"message": str(e)})
