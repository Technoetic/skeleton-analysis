import pandas as pd
import math


class DataService:
    _cache: list[dict] | None = None

    @classmethod
    def load(cls, csv_path: str) -> list[dict]:
        df = pd.read_csv(csv_path)
        cols_to_keep = [
            "date", "session", "gender", "format", "nat", "start_no",
            "name", "run", "status", "start_time", "int1", "int2",
            "int3", "int4", "finish", "speed",
        ]
        existing = [c for c in cols_to_keep if c in df.columns]
        df = df[existing]

        records = df.to_dict(orient="records")
        for rec in records:
            for k, v in rec.items():
                if isinstance(v, float) and math.isnan(v):
                    rec[k] = None
        cls._cache = records
        return records

    @classmethod
    def get_records(cls) -> list[dict]:
        if cls._cache is None:
            raise RuntimeError("Data not loaded. Call load() first.")
        return cls._cache
