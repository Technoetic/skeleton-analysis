"""스켈레톤 기록 캐시 — 로컬 테이블 저장소에서 적재한다 (구 Supabase 로드 대체)."""

API_COLUMNS = [
    "date", "session", "gender", "format", "nat", "start_no",
    "name", "run", "status", "start_time", "int1", "int2",
    "int3", "int4", "finish", "speed",
]


class DataService:
    _cache: list[dict] | None = None

    @classmethod
    def load_local(cls, rows: list[dict]) -> list[dict]:
        ordered = sorted(rows, key=lambda r: r.get("id") or 0)
        cls._cache = [{c: r.get(c) for c in API_COLUMNS} for r in ordered]
        return cls._cache

    @classmethod
    def get_records(cls) -> list[dict]:
        if cls._cache is None:
            raise RuntimeError("Data not loaded. Call load_local() first.")
        return cls._cache
