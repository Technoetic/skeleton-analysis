# -*- coding: utf-8 -*-
"""Supabase 소멸(2026-07) 후 로컬 CSV 데이터 재구성 스크립트.

원본 Supabase 프로젝트(dxaehcocrbvhatyfmrvp)가 삭제되어 DNS조차 해석되지 않으므로,
git 히스토리와 레포 내 스크립트에서 데이터를 재구성한다. 산출물은 data/ 아래에
커밋되어 이후 백엔드가 로컬에서 직접 서빙한다 (backend/local_data.py).

재구성 근거 (SoT):
- skeleton 기록 1,185행: 커밋 145fd41의 skeleton_weather_combined.csv (data/에 재수록)
- 국내대회 추가 42행: scripts/add_pdf_data.py (하드코딩 레코드, 그대로 실행)
- seg1..5 공식: web/src/js/UIController.js:823 (seg1=int1-start_time, seg2=int2-int1, ...)
- is_normal: status=='OK' AND 50<=finish<=60 (Chatbot.js:648,1491 동치 사용)
- athlete_id 23명 canonical: 커밋 118aefa train_pipeline.py SKEL_KEEP_ATHLETE_IDS
  (나머지는 luge 관례 integrate_luge_women_intl.py:22 md5 파생 — records/athletes 동일 규칙으로 조인 정합)
- name_kr: web/src/js/Chatbot.js _korNameMap 역매핑 (SoT 외 한글명 발명 금지)
- athletes/bobsled_athletes의 birth_year/height/weight: 원본 소멸로 복구 불가 → 공란
- track_metadata: 원본 소멸 + 레포에 시드 없음 → 헤더만 (프런트는 빈 배열에 안전)
"""
import hashlib
import shutil
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"

CANON_IDS = {
    "YEO Chanhyuk": "ATH-81CCC6D3", "HONG Sujung": "ATH-CCB3D4AE",
    "KIM Yerim": "ATH-16B2F494", "SHIN Yeonsu": "ATH-91E60E21",
    "CHUNG Yeeun": "ATH-8A0E894D", "KIM Minji": "ATH-075364AA",
    "KWACK Eunwoo": "ATH-F6E5D0C9", "AN Jaewoong": "ATH-E68E8959",
    "KIM Jisoo": "ATH-B78B10F1", "JUNG Seunggi": "ATH-56A76FCD",
    "JUNG Janghwan": "ATH-54955BB9", "SONG Youngmin": "ATH-15459358",
    "TAKAHASHI Hiroatsu": "ATH-830BBF37", "NAGAO Taido": "ATH-80A2ED01",
    "TIMMINGS Nicholas": "ATH-E141DBED", "UHLAENDER Katie": "ATH-5BF779CF",
    "KAWANO Hayato": "ATH-DE295AEB", "PENG Lin-Wei": "ATH-0A5C0017",
    "BOSTOCK Laurence": "ATH-1A4821B0", "DELKA Kellie": "ATH-DAD23CF0",
    "ZHU Yangqi": "ATH-51778208", "VARGAS Laura": "ATH-0926CF11",
    "FREELING Colin": "ATH-F8836987",
}

# Chatbot.js _korNameMap 역매핑 + 로마자 표기 변형 (발명 금지 원칙)
NAME_KR = {
    "YEO Chanhyuk": "여찬혁", "KIM Jisoo": "김지수", "HONG Sujung": "홍수정",
    "JUNG Seunggi": "정승기", "SHIN Yeonsu": "신연수",
    "LEE Seunghun": "이승훈", "LEE Seunghoon": "이승훈",
    "JUNG Yeeun": "정예은", "CHUNG Yeeun": "정예은",
    "AHN Jaeung": "안재웅", "AN Jaewoong": "안재웅",
    "PARK Yewoon": "박예운", "SONG Youngmin": "송영민", "KWACK Eunwoo": "곽은우",
}

COLS = ["id", "date", "session", "gender", "format", "nat", "start_no", "name",
        "run", "status", "start_time", "int1", "int2", "int3", "int4", "finish",
        "speed", "athlete_id", "air_temp", "humidity_pct", "pressure_hpa",
        "wind_speed_ms", "dewpoint_c", "ice_temp_est", "temp_avg",
        "seg1", "seg2", "seg3", "seg4", "seg5", "is_normal"]

RENAME = {
    "기상청_기온평균_C": "air_temp",
    "기상청_습도평균_pct": "humidity_pct",
    "기상청_현지기압_hPa": "pressure_hpa",  # 현지기압(~932hPa) — 해면기압 사용 금지
    "기상청_풍속평균_ms": "wind_speed_ms",
    "기상청_이슬점평균_C": "dewpoint_c",
}


def mk_id(name: str) -> str:
    return CANON_IDS.get(name, "ATH-" + hashlib.md5(name.encode()).hexdigest()[:8].upper())


def recompute_segments(df: pd.DataFrame) -> pd.DataFrame:
    for c in ["start_time", "int1", "int2", "int3", "int4", "finish"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df["seg1"] = df["int1"] - df["start_time"]
    df["seg2"] = df["int2"] - df["int1"]
    df["seg3"] = df["int3"] - df["int2"]
    df["seg4"] = df["int4"] - df["int3"]
    df["seg5"] = df["finish"] - df["int4"]
    return df


def build_skeleton_records() -> pd.DataFrame:
    src = pd.read_csv(DATA / "skeleton_weather_combined.csv")
    df = src.rename(columns=RENAME)
    df = recompute_segments(df)
    df["is_normal"] = (df["status"] == "OK") & df["finish"].between(50, 60)
    df["athlete_id"] = df["name"].map(mk_id)
    df["ice_temp_est"] = None
    df = df.sort_values(["date", "name", "run"]).reset_index(drop=True)
    df["id"] = range(1, len(df) + 1)
    base = df[COLS]

    # add_pdf_data.py는 cwd의 skeleton_records.csv를 읽어 42행을 이어 붙인다
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        base.to_csv(tmp / "skeleton_records.csv", index=False, encoding="utf-8-sig")
        subprocess.run([sys.executable, str(ROOT / "scripts" / "add_pdf_data.py")],
                       cwd=tmp, check=True, capture_output=True)
        merged = pd.read_csv(tmp / "skeleton_records.csv")

    # add_pdf가 seg를 None으로 두므로 전 행 일괄 재계산
    merged = recompute_segments(merged)
    merged.to_csv(DATA / "skeleton_records.csv", index=False, encoding="utf-8-sig")
    return merged


def most_common(series) -> str:
    vals = [v for v in series if isinstance(v, str) and v.strip()]
    return Counter(vals).most_common(1)[0][0] if vals else ""


def build_skeleton_athletes(records: pd.DataFrame) -> None:
    rows = []
    for i, (name, grp) in enumerate(sorted(records.groupby("name"), key=lambda x: x[0]), 1):
        gender = most_common(grp["gender"][grp["gender"].isin(["M", "W", "F"])])
        rows.append({
            "id": i, "athlete_id": mk_id(name), "name": name,
            "nat": most_common(grp["nat"]), "birth_year": None, "gender": gender or None,
            "height_cm": None, "weight_kg": None, "name_kr": NAME_KR.get(name),
        })
    pd.DataFrame(rows).to_csv(DATA / "athletes.csv", index=False, encoding="utf-8-sig")


def build_bobsled_athletes() -> None:
    bob = pd.read_csv(ROOT / "bobsled_records.csv")
    rows, seen, i = [], set(), 1
    for role, col in [("pilot", "pilot"), ("brakeman", "brakeman")]:
        for name, grp in bob.groupby(col):
            if not isinstance(name, str) or not name.strip() or (name, role) in seen:
                continue
            seen.add((name, role))
            rows.append({
                "id": i, "athlete_id": mk_id(name), "name": name,
                "nat": most_common(grp["nat"]), "birth_year": None,
                "gender": most_common(grp["gender"][grp["gender"].isin(["M", "W", "F"])]) or None,
                "height_cm": None, "weight_kg": None, "role": role, "name_kr": None,
            })
            i += 1
    pd.DataFrame(rows).to_csv(DATA / "bobsled_athletes.csv", index=False, encoding="utf-8-sig")


def build_track_metadata() -> None:
    cols = ["curve_number", "radius_m", "banking_deg", "difficulty", "coaching_tip"]
    pd.DataFrame(columns=cols).to_csv(DATA / "track_metadata.csv", index=False, encoding="utf-8-sig")


def main() -> None:
    DATA.mkdir(exist_ok=True)
    records = build_skeleton_records()
    build_skeleton_athletes(records)
    build_bobsled_athletes()
    build_track_metadata()
    print(f"skeleton_records: {len(records)} rows")
    print(f"athletes: {len(pd.read_csv(DATA / 'athletes.csv'))} rows")
    print(f"bobsled_athletes: {len(pd.read_csv(DATA / 'bobsled_athletes.csv'))} rows")


if __name__ == "__main__":
    main()
