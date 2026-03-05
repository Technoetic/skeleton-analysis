from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.config import CORS_ORIGINS, CSV_PATH, STATIC_DIR
from backend.data_service import DataService
from backend.models import SkeletonRecord


@asynccontextmanager
async def lifespan(app: FastAPI):
    DataService.load(CSV_PATH)
    print(f"Loaded {len(DataService.get_records())} records from {CSV_PATH}")
    yield


app = FastAPI(title="Skeleton Race API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/records", response_model=list[SkeletonRecord])
def get_records():
    return DataService.get_records()


@app.get("/")
def serve_index():
    return FileResponse(f"{STATIC_DIR}/index.html")


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
