from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
import httpx

from backend.config import (
    CORS_ORIGINS, STATIC_DIR,
    BIZROUTER_API_KEY, BIZROUTER_API_URL,
)
from backend.data_service import DataService
from backend.local_data import load_tables
from backend.models import SkeletonRecord
from backend.postgrest_shim import router as postgrest_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    tables = load_tables()
    records = DataService.load_local(tables["skeleton_records"])
    counts = {name: len(rows) for name, rows in tables.items()}
    print(f"Loaded local tables: {counts} (skeleton cache: {len(records)})")
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


@app.get("/api/config")
def get_config():
    # Supabase 소멸(2026-07) — 빈 문자열이면 프런트가 동일 오리진 /rest/v1(shim)을 호출한다.
    # undefined 방지를 위해 반드시 문자열 ''을 명시 반환해야 한다.
    return {"supabaseUrl": "", "supabaseKey": ""}


@app.post("/api/chat")
async def chat_proxy(request: Request):
    body = await request.json()
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            BIZROUTER_API_URL,
            json=body,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {BIZROUTER_API_KEY}",
            },
        )
        return resp.json()


@app.api_route("/api/kma/{path:path}", methods=["GET", "POST"])
async def kma_proxy(request: Request, path: str):
    target = f"https://apihub.kma.go.kr/api/{path}"
    params = dict(request.query_params)
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.request(
            request.method,
            target,
            params=params,
            headers={"Host": "apihub.kma.go.kr"},
        )
        return Response(content=resp.content, status_code=resp.status_code,
                        media_type=resp.headers.get("content-type", "application/json"))


@app.api_route("/api/llm/{path:path}", methods=["GET", "POST"])
async def llm_proxy(request: Request, path: str):
    target = f"https://bizrouter.ai/api/v1/{path}"
    body = await request.body()
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.request(
            request.method,
            target,
            content=body,
            headers={
                "Host": "bizrouter.ai",
                "Content-Type": "application/json",
                "Authorization": f"Bearer {BIZROUTER_API_KEY}",
            },
        )
        return Response(content=resp.content, status_code=resp.status_code,
                        media_type=resp.headers.get("content-type", "application/json"))


@app.get("/")
def serve_index():
    return FileResponse(f"{STATIC_DIR}/index.html")


app.include_router(postgrest_router)

app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
