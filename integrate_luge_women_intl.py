"""
루지 국제대회 여자 싱글 파싱 데이터 → luge_records.csv 통합 + Supabase 업로드
"""
import sys
sys.stdout.reconfigure(encoding='utf-8')

import pandas as pd
import numpy as np
import hashlib
import requests

# ── 설정 ──
SUPABASE_URL = 'https://dxaehcocrbvhatyfmrvp.supabase.co'
SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4YWVoY29jcmJ2aGF0eWZtcnZwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTk0MDAxNywiZXhwIjoyMDg3NTE2MDE3fQ.VVnZrN6hfAeMxKZ5i3-_iUAjPzo8xvgkRbEfonYT2wM'
HEADERS = {
    'apikey': SUPABASE_KEY,
    'Authorization': f'Bearer {SUPABASE_KEY}',
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal',
}

def make_athlete_id(name):
    """이름 기반 athlete_id 생성"""
    h = hashlib.md5(name.encode()).hexdigest()[:8].upper()
    return f'ATH-{h}'


def main():
    # 1. 파싱된 데이터 로드
    df_new = pd.read_csv('luge_women_intl_parsed.csv')
    print(f'파싱 데이터: {len(df_new)}건')

    # 중복 제거: D1 GB dup 파일 (같은 내용)
    before = len(df_new)
    df_new = df_new[~df_new['event'].str.contains('dup')].copy()
    print(f'중복(dup) 제거: {before}건 → {len(df_new)}건')

    # 2. 기존 luge_records 로드
    df_old = pd.read_csv('luge_records.csv')
    print(f'기존 luge_records: {len(df_old)}건')

    # 3. 새 데이터 컬럼 매핑
    # 기존 luge_records 컬럼: id,file,date,session,gender,format,nat,start_no,name,run,status,
    #   start_time,int1,int2,int3,int4,finish,speed,athlete_id,temp_avg,air_temp,humidity_pct,
    #   pressure_hpa,dewpoint_c,wind_speed_ms,seg1,seg2,seg3,seg4,seg5,is_normal

    # athlete_id 생성
    df_new['athlete_id'] = df_new['name'].apply(make_athlete_id)

    # 이름 정규화 (대소문자 통일)
    # 기존: 한글 이름 또는 영문 대문자 (KIM Jimin, 김지민)
    # 새 데이터: 영문 이름 (GEISENBERGER Natalie, Jung, Hyesun 등)

    # 컬럼 매핑
    new_id_start = int(df_old['id'].max()) + 1
    df_new['id'] = range(new_id_start, new_id_start + len(df_new))
    df_new['file'] = df_new['event']  # 원본 파일 대신 이벤트명 사용
    df_new['session'] = None
    df_new['start_no'] = None
    df_new['temp_avg'] = df_new['ice_temp']  # 빙면온도를 temp_avg로

    # 이슬점 추정 (air_temp와 빙면온도 기반)
    df_new['humidity_pct'] = None
    df_new['pressure_hpa'] = None
    df_new['dewpoint_c'] = None
    df_new['wind_speed_ms'] = None

    # 구간 시간 (seg1~seg5) → 없음
    for col in ['seg1', 'seg2', 'seg3', 'seg4', 'seg5']:
        df_new[col] = None

    # 컬럼 순서 맞추기
    target_cols = df_old.columns.tolist()
    for col in target_cols:
        if col not in df_new.columns:
            df_new[col] = None

    df_new = df_new[target_cols]

    # 4. 합치기
    df_combined = pd.concat([df_old, df_new], ignore_index=True)
    print(f'\n통합 결과: {len(df_old)} + {len(df_new)} = {len(df_combined)}건')

    # 5. CSV 저장
    df_combined.to_csv('luge_records.csv', index=False, encoding='utf-8-sig')
    print(f'→ luge_records.csv 저장 완료')

    # 6. luge_athletes 업데이트 (새 선수 추가)
    df_ath = pd.read_csv('luge_athletes.csv')
    existing_ids = set(df_ath['athlete_id'])

    new_athletes = df_new[['athlete_id', 'name', 'nat', 'gender']].drop_duplicates('athlete_id')
    new_athletes = new_athletes[~new_athletes['athlete_id'].isin(existing_ids)]

    if len(new_athletes) > 0:
        new_athletes['height_cm'] = None
        new_athletes['weight_kg'] = None
        new_athletes['birth_year'] = None
        new_athletes['name_kr'] = None
        new_athletes['matched_2425'] = False

        # id 부여
        max_id = int(df_ath['id'].max()) if 'id' in df_ath.columns and len(df_ath) > 0 else 0
        new_athletes['id'] = range(max_id + 1, max_id + 1 + len(new_athletes))

        for col in df_ath.columns:
            if col not in new_athletes.columns:
                new_athletes[col] = None
        new_athletes = new_athletes[df_ath.columns]

        df_ath_combined = pd.concat([df_ath, new_athletes], ignore_index=True)
        df_ath_combined.to_csv('luge_athletes.csv', index=False, encoding='utf-8-sig')
        print(f'→ luge_athletes.csv 업데이트: {len(new_athletes)}명 추가 (총 {len(df_ath_combined)}명)')
    else:
        print(f'→ 새 선수 없음')

    # 7. Supabase 업로드
    print(f'\nSupabase 업로드 시작...')
    upload_records = df_new.where(pd.notnull(df_new), None).to_dict('records')

    # 배치 업로드 (50건씩)
    batch_size = 50
    uploaded = 0
    for i in range(0, len(upload_records), batch_size):
        batch = upload_records[i:i+batch_size]
        # None → JSON null, NaN 처리
        for rec in batch:
            for k, v in rec.items():
                if isinstance(v, float) and np.isnan(v):
                    rec[k] = None

        resp = requests.post(
            f'{SUPABASE_URL}/rest/v1/luge_records',
            headers=HEADERS,
            json=batch,
        )
        if resp.status_code in (200, 201):
            uploaded += len(batch)
            print(f'  {uploaded}/{len(upload_records)}건 업로드 완료')
        else:
            print(f'  업로드 오류 ({resp.status_code}): {resp.text[:200]}')
            break

    # 선수 업로드
    if len(new_athletes) > 0:
        ath_records = new_athletes.where(pd.notnull(new_athletes), None).to_dict('records')
        for rec in ath_records:
            for k, v in rec.items():
                if isinstance(v, float) and np.isnan(v):
                    rec[k] = None
        resp = requests.post(
            f'{SUPABASE_URL}/rest/v1/luge_athletes',
            headers=HEADERS,
            json=ath_records,
        )
        if resp.status_code in (200, 201):
            print(f'  선수 {len(ath_records)}명 업로드 완료')
        else:
            print(f'  선수 업로드 오류: {resp.text[:200]}')

    print(f'\n=== 통합 완료 ===')
    print(f'luge_records: {len(df_combined)}건')
    print(f'  기존: {len(df_old)}건')
    print(f'  추가: {len(df_new)}건')
    print(f'  여자 국제대회 기록: 날짜 {df_new["date"].nunique()}일, '
          f'선수 {df_new["name"].nunique()}명, 국가 {df_new["nat"].nunique()}개국')


if __name__ == '__main__':
    main()
