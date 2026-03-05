from pydantic import BaseModel


class SkeletonRecord(BaseModel):
    date: str | None = None
    session: str | None = None
    gender: str | None = None
    format: str | None = None
    nat: str | None = None
    start_no: int | None = None
    name: str | None = None
    run: int | None = None
    status: str | None = None
    start_time: float | None = None
    int1: float | None = None
    int2: float | None = None
    int3: float | None = None
    int4: float | None = None
    finish: float | None = None
    speed: float | None = None
