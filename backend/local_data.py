"""로컬 CSV 테이블 저장소 — 소멸한 Supabase를 대체한다.

data/·루트의 CSV를 메모리에 적재하고, postgrest_shim이 이를 서빙한다.
의존성 없이 표준 csv 모듈만 사용한다 (배포 이미지는 fastapi/uvicorn/httpx만 설치).
"""
import csv
import os

_BASE = os.path.join(os.path.dirname(__file__), "..")

TABLE_FILES = {
    "skeleton_records": "data/skeleton_records.csv",
    "athletes": "data/athletes.csv",
    "luge_records": "luge_records.csv",
    "luge_athletes": "data/luge_athletes.csv",
    "bobsled_records": "bobsled_records.csv",
    "bobsled_athletes": "data/bobsled_athletes.csv",
    "track_metadata": "data/track_metadata.csv",
}

_tables: dict[str, list[dict]] | None = None


def _coerce(col: str, raw: str):
    if raw is None:
        return None
    v = raw.strip()
    if v == "":
        return None
    if col == "is_normal":
        return v.lower() in ("1", "true", "t", "y", "yes")
    try:
        return int(v)
    except ValueError:
        pass
    try:
        return float(v)
    except ValueError:
        return v


def load_tables() -> dict[str, list[dict]]:
    global _tables
    tables: dict[str, list[dict]] = {}
    for name, rel in TABLE_FILES.items():
        path = os.path.join(_BASE, rel)
        rows: list[dict] = []
        with open(path, encoding="utf-8-sig", newline="") as f:
            for rec in csv.DictReader(f):
                rows.append({k: _coerce(k, v) for k, v in rec.items()})
        tables[name] = rows
    _tables = tables
    return tables


def get_tables() -> dict[str, list[dict]]:
    if _tables is None:
        return load_tables()
    return _tables
