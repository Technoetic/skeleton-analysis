# =============================================================
# 썰매 3종목 AI 예측 모델 학습 파이프라인
# Master Guide v2.0 기반
# 종목: 스켈레톤 / 봅슬레이(2인승) / 루지
# =============================================================

import pandas as pd
import numpy as np
import os
import json
import httpx
import joblib
import xgboost as xgb
from sklearn.model_selection import train_test_split, GridSearchCV
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_squared_error, r2_score

# =============================================================
# 설정
# =============================================================
SAVE_DIR = r'C:\Users\Admin\Desktop\새 폴더'

SUPABASE_URL = 'https://dxaehcocrbvhatyfmrvp.supabase.co'
SUPABASE_KEY = 'sb_publishable_5_U3dll4HB9fAXOxmgm83w_wnOiei-e'
HEADERS = {
    'apikey': SUPABASE_KEY,
    'Authorization': f'Bearer {SUPABASE_KEY}'
}

TABLES = [
    'skeleton_records',
    'bobsled_records',
    'luge_records',
    'athletes',
    'bobsled_athletes',
    'luge_athletes',
    'track_metadata',
]

# 루지 정예 멤버 11명
LUGE_ELITE_NAMES = [
    'KIM Jimin', 'OH Jeongim', 'PARK Jiye', 'KIM Kyeongrok',
    'PARK Jiwan', 'BAE Jaeseong', 'KIM Soyun', 'YOO Jihun',
    'JUNG Hyeseon', 'SHIN Yubin', 'KIM Bogeun',
    '김지민', '오정임', '박지예', '김경록', '박지완',
    '배재성', '김소윤', '유지훈', '정혜선', '신유빈', '김보근'
]

# 봅슬레이 제외 선수
BOB_DROP_PILOTS = ['배한결', '노윤효', '채병도']

# 스켈레톤: 완전 제외 선수 (행 자체 삭제)
SKEL_DROP_NAMES = ['PARK Yewoon', 'TORRES QUEVEDO Ana', 'RODRIGUEZ Adrian',
                   'JEONG Yeyeon', 'LEE Seunghoon']

# 스켈레톤: athlete_id 유지 선수는 athletes 테이블에서 동적으로 결정
# (DROP_NAMES 제외 + 주행 5건 이상인 선수만 유지, 나머지 → NULL)

# 스켈레톤: finish 상한선 적용할 선수 {이름: 최대 finish}
SKEL_FINISH_CAP = {
    'JUNG Janghwan': 54.5,
    'SONG Youngmin': 54.5,
}


# =============================================================
# STEP 1. Supabase → CSV 다운로드
# =============================================================
def fetch_all(table):
    """Supabase REST API로 테이블 전체 데이터 가져오기 (페이지네이션)"""
    all_rows = []
    offset = 0
    limit = 1000
    while True:
        resp = httpx.get(
            f'{SUPABASE_URL}/rest/v1/{table}',
            params={'select': '*', 'limit': str(limit), 'offset': str(offset)},
            headers=HEADERS,
            timeout=30
        )
        data = resp.json()
        if not isinstance(data, list) or len(data) == 0:
            if not isinstance(data, list):
                print(f'  오류: {data}')
            break
        all_rows.extend(data)
        if len(data) < limit:
            break
        offset += limit
    return all_rows


def download_all_tables():
    """모든 테이블을 CSV로 저장"""
    os.makedirs(SAVE_DIR, exist_ok=True)
    print('Supabase → CSV 다운로드 시작')
    print('=' * 50)
    for table in TABLES:
        print(f'[{table}] 다운로드 중...', end=' ', flush=True)
        rows = fetch_all(table)
        if rows:
            df = pd.DataFrame(rows)
            path = os.path.join(SAVE_DIR, f'{table}.csv')
            df.to_csv(path, index=False, encoding='utf-8-sig')
            print(f'{len(df):,}행 저장 완료')
        else:
            print('(빈 테이블 또는 오류)')
    print('\nCSV 다운로드 완료\n')


# =============================================================
# STEP 2. 공통 전처리 함수
# =============================================================
def calc_air_density(df):
    """공기밀도 파생변수 계산: Air_Density = P / (R * T)"""
    df['Air_Density'] = (df['pressure_hpa'] * 100) / (287.05 * (df['air_temp'] + 273.15))
    return df


def filter_normal_runs(df):
    """is_normal 컬럼 기준으로 정상 완주 데이터만 필터링"""
    df['is_normal'] = df['is_normal'].astype(str).str.strip().str.lower()
    valid_flags = ['1', '1.0', 'true', 't', 'y', 'yes']
    return df[df['is_normal'].isin(valid_flags)].copy()


def apply_common_preprocessing(df_records, df_athletes, sport_name, use_physical=True):
    """
    공통 전처리 파이프라인
    1. 정상 완주 필터링
    2. 신체 데이터 병합 (봅슬레이 제외)
    3. 숫자 강제 변환 + 결측치 삭제
    4. 공기밀도 파생변수 생성
    """
    df = filter_normal_runs(df_records)

    if use_physical:
        df = pd.merge(df, df_athletes[['athlete_id', 'height_cm', 'weight_kg']], on='athlete_id', how='left')
        core_cols = ['start_time', 'finish', 'air_temp', 'pressure_hpa', 'dewpoint_c', 'height_cm', 'weight_kg']
    else:
        core_cols = ['start_time', 'finish', 'air_temp', 'pressure_hpa', 'dewpoint_c']

    for col in core_cols:
        df[col] = pd.to_numeric(df[col], errors='coerce')

    before = len(df)
    df = df.dropna(subset=core_cols).copy()
    df = calc_air_density(df)

    print(f'[{sport_name}] 전처리 완료: {before}건 → {len(df)}건 생존')
    return df


# =============================================================
# STEP 3. 종목별 전처리
# =============================================================
def preprocess_skeleton(df_skel, df_ath_skel):
    """
    스켈레톤 전처리
    1. 제외 선수 5명 완전 삭제
    2. 정상완주 필터링 + 신체 데이터 병합 + 결측치 제거
    3. finish < 50초 제거 (주니어스타트 이상치)
    4. start_time < 4.5초 제거 (다른 구간 이상치)
    5. 선수별 최고 start_time 기준 +0.6초 초과 제거
    6. 선수별 평균 speed 기준 -5km/h 미만 제거
    7. BMI 파생변수 생성
    8. 유지 선수 외 athlete_id → NULL
    """
    # 1. 완전 제외 선수 삭제
    df_skel = df_skel[~df_skel['name'].isin(SKEL_DROP_NAMES)].copy()

    # TAKAHASHI Hiroatsu: KOR 국적 → JPN 으로 통일
    df_skel.loc[
        (df_skel['name'] == 'TAKAHASHI Hiroatsu') & (df_skel['nat'] == 'KOR'), 'nat'
    ] = 'JPN'

    # 2. 공통 전처리 (정상완주 + 신체 병합 + 결측치 제거 + 공기밀도)
    df = apply_common_preprocessing(df_skel, df_ath_skel, '스켈레톤', use_physical=True)

    # 3. finish < 50초 제거 (주니어스타트 이상치)
    before = len(df)
    df = df[df['finish'] >= 50.0]
    print(f'  finish < 50초 제거: {before - len(df)}건')

    # 4. start_time < 4.5초 제거 (다른 구간 이상치)
    before = len(df)
    df = df[df['start_time'] >= 4.5]
    print(f'  start < 4.5초 제거: {before - len(df)}건')

    # 5. 선수별 최고 start_time 기준 +0.6초 초과 제거
    start_best = df.groupby('name')['start_time'].min().rename('start_best')
    df = df.join(start_best, on='name')
    before = len(df)
    df = df[df['start_time'] <= df['start_best'] + 0.6].copy()
    df.drop(columns=['start_best'], inplace=True)
    print(f'  start +0.6초 초과 제거: {before - len(df)}건')

    # 6. 선수별 평균 speed - 5km/h 미만 제거
    speed_mean = df.groupby('name')['speed'].mean().rename('speed_mean')
    df = df.join(speed_mean, on='name')
    before = len(df)
    df = df[df['speed'] >= df['speed_mean'] - 5].copy()
    df.drop(columns=['speed_mean'], inplace=True)
    print(f'  speed 평균-5 미만 제거: {before - len(df)}건')
    print(f'  최종 생존: {len(df)}건')

    # 7. 선수별 finish 상한선 적용 (정장환, 송영민: 54.5초 초과 제거)
    for player_name, cap in SKEL_FINISH_CAP.items():
        before = len(df)
        df = df[~((df['name'] == player_name) & (df['finish'] > cap))]
        removed = before - len(df)
        if removed > 0:
            print(f'  {player_name} finish > {cap}초 제거: {removed}건')

    # 8. BMI 파생변수
    df['BMI'] = df['weight_kg'] / ((df['height_cm'] / 100) ** 2)

    # 9. 유지 선수 외 athlete_id → NULL (athletes 테이블에서 동적으로 결정)
    all_athlete_ids = set(df_ath_skel['athlete_id'].dropna())
    drop_athlete_ids = set(
        df_ath_skel.loc[df_ath_skel['name'].isin(SKEL_DROP_NAMES), 'athlete_id'].dropna()
    )
    run_counts = df['athlete_id'].value_counts()
    low_data_ids = set(run_counts[run_counts < 5].index)
    keep_ids = all_athlete_ids - drop_athlete_ids - low_data_ids
    null_count = df['athlete_id'].notna().sum() - df['athlete_id'].isin(keep_ids).sum()
    df.loc[~df['athlete_id'].isin(keep_ids), 'athlete_id'] = None
    print(f'  athlete_id 유지: {len(keep_ids)}명, NULL 처리: {null_count}건')

    # 10. 구간별 빙면 온도 매핑 (ice_zone1~5)
    zone_json = os.path.join(SAVE_DIR, 'ice_zone_temps.json')
    if os.path.exists(zone_json):
        with open(zone_json, 'r') as f:
            zone_temps = json.load(f)
        for zone in ['ice_zone1', 'ice_zone2', 'ice_zone3', 'ice_zone4', 'ice_zone5']:
            df[zone] = df['date'].map({d: v.get(zone) for d, v in zone_temps.items()})
        # fallback: zone 없으면 temp_avg로 채움
        for zone in ['ice_zone1', 'ice_zone2', 'ice_zone3', 'ice_zone4', 'ice_zone5']:
            mask = df[zone].isna() & df['temp_avg'].notna()
            df.loc[mask, zone] = df.loc[mask, 'temp_avg']
        zone_valid = df['ice_zone1'].notna().sum()
        print(f'  구간별 빙면온도 매핑: {zone_valid}건 유효')
    else:
        print(f'  경고: {zone_json} 없음 → temp_avg만 사용')

    return df


def preprocess_bobsled(df_bob):
    """
    봅슬레이 전처리
    - 신체 데이터 없이 기상 데이터만 사용
    - 제외 선수: 배한결, 노윤효, 채병도
    - 김현유: 2026-02-03 이후 데이터만 사용
    - finish < 50초 제거 (모노밥/숏트랙 이상치)
    - finish > 62초 제거 (극단 이상치)
    """
    df = apply_common_preprocessing(df_bob, None, '봅슬레이', use_physical=False)

    # 예외 선수 제거
    df = df[~df['pilot'].isin(BOB_DROP_PILOTS)]

    # 김현유 선수 날짜 필터링
    df['date'] = pd.to_datetime(df['date'], errors='coerce')
    df = df[~((df['pilot'] == '김현유') & (df['date'] < '2026-02-03'))]

    # 모노밥/숏트랙 이상치 제거 (finish < 50초 또는 > 62초)
    before = len(df)
    df = df[(df['finish'] >= 50.0) & (df['finish'] <= 62.0)]
    print(f'[봅슬레이] finish 범위 필터(50~62초): {before}건 → {len(df)}건')

    print(f'[봅슬레이] 선수 필터링 후: {len(df)}건')
    return df


def assign_luge_start_location(st):
    """루지 스타트 구간 분류"""
    if st < 4.0:
        return 'Men Start'
    elif 4.0 <= st < 6.4:
        return 'Lady Start'
    elif 6.4 <= st < 8.0:
        return 'Junior Start'
    else:
        return 'Drop'


def preprocess_luge(df_luge, df_ath_luge):
    """
    루지 전처리
    - 정예 멤버 11명만 선택
    - 스타트 구간 파생변수 (Start_Location) 생성
    - 성별(gender) 컬럼 정규화
    """
    # 정예 멤버 필터링
    df_elite = df_luge[df_luge['name'].isin(LUGE_ELITE_NAMES)].copy()
    print(f'[루지] 정예 멤버 필터링: {len(df_luge)}건 → {len(df_elite)}건')

    df = apply_common_preprocessing(df_elite, df_ath_luge, '루지', use_physical=True)

    # 스타트 구간 파생변수
    df['Start_Location'] = df['start_time'].apply(assign_luge_start_location)
    df = df[df['Start_Location'] != 'Drop']

    # 성별 정규화
    df['gender'] = df['gender'].astype(str).str.strip().str.upper()

    print(f'[루지] 스타트 구간 분포:\n{df["Start_Location"].value_counts().to_string()}')
    return df


# =============================================================
# STEP 4. 모델 학습 함수
# =============================================================
def train_xgboost(df, sport_name, feature_cols, cat_cols=None, model_filename=None):
    """
    XGBoost GridSearchCV 학습
    - 과적합 방지 최우선 (얕은 트리 깊이)
    - .pkl 파일로 저장
    """
    if cat_cols is None:
        cat_cols = []

    df_encoded = pd.get_dummies(df, columns=cat_cols, drop_first=True)
    ohe_cols = [col for col in df_encoded.columns if any(c + '_' in col for c in cat_cols)]
    final_features = feature_cols + ohe_cols

    # feature_cols 중 실제로 존재하는 컬럼만 사용
    final_features = [f for f in final_features if f in df_encoded.columns]

    X = df_encoded[final_features].astype(float)
    y = df_encoded['finish'].astype(float)

    # feature에 NaN 있는 행 제거
    valid_mask = X.notna().all(axis=1)
    X = X[valid_mask]
    y = y[valid_mask]

    if len(X) < 10:
        print(f'  [{sport_name}] 데이터 부족으로 학습 불가 ({len(X)}건)')
        return None

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    param_grid = {
        'max_depth': [3, 4, 5],
        'learning_rate': [0.05, 0.1],
        'n_estimators': [100, 200, 300],
        'subsample': [0.8, 1.0]
    }

    grid_search = GridSearchCV(
        xgb.XGBRegressor(random_state=42),
        param_grid,
        cv=3,
        scoring='neg_root_mean_squared_error',
        n_jobs=-1,
        verbose=0
    )
    grid_search.fit(X_train, y_train)
    best_model = grid_search.best_estimator_

    y_pred = best_model.predict(X_test)
    rmse = np.sqrt(mean_squared_error(y_test, y_pred))
    r2 = r2_score(y_test, y_pred)

    print(f'\n[{sport_name}] 학습 완료')
    print(f'  최적 파라미터: {grid_search.best_params_}')
    print(f'  R² (설명력): {r2 * 100:.2f}%')
    print(f'  RMSE (평균 오차): {rmse:.4f}초')

    if model_filename is None:
        model_filename = f'{sport_name}_xgboost_model.pkl'
    save_path = os.path.join(SAVE_DIR, model_filename)
    joblib.dump(best_model, save_path)
    print(f'  모델 저장: {save_path}')

    return best_model


def train_mlr(df, sport_name, feature_cols):
    """
    다중선형회귀(MLR) 학습 - 코칭 인사이트(변수별 가중치) 추출용
    """
    X = df[[c for c in feature_cols if c in df.columns]].astype(float)
    y = df['finish'].astype(float)
    valid_mask = X.notna().all(axis=1)
    X = X[valid_mask]
    y = y[valid_mask]
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    mlr = LinearRegression()
    mlr.fit(X_train, y_train)
    y_pred = mlr.predict(X_test)

    print(f'\n[{sport_name} MLR 코칭 인사이트]')
    print(f'  R²: {r2_score(y_test, y_pred) * 100:.2f}%')
    print(f'  RMSE: {np.sqrt(mean_squared_error(y_test, y_pred)):.4f}초')
    print('  변수별 계수(가중치):')
    for feat, coef in zip(feature_cols, mlr.coef_):
        print(f'    {feat}: {coef:.6f}')

    return mlr


# =============================================================
# STEP 5. 메인 실행
# =============================================================
def main():
    # ----------------------------------------------------------
    # 1. 데이터 로드 (CSV가 없으면 Supabase에서 다운로드)
    # ----------------------------------------------------------
    csv_path = os.path.join(SAVE_DIR, 'skeleton_records.csv')
    if not os.path.exists(csv_path):
        print('CSV 파일 없음 → Supabase에서 다운로드합니다.')
        download_all_tables()
    else:
        print('CSV 파일 존재 → 로컬에서 바로 로드합니다.\n')

    df_skel   = pd.read_csv(os.path.join(SAVE_DIR, 'skeleton_records.csv'))
    df_bob    = pd.read_csv(os.path.join(SAVE_DIR, 'bobsled_records.csv'))
    df_luge   = pd.read_csv(os.path.join(SAVE_DIR, 'luge_records.csv'))
    df_ath_skel  = pd.read_csv(os.path.join(SAVE_DIR, 'athletes.csv'))
    df_ath_bob   = pd.read_csv(os.path.join(SAVE_DIR, 'bobsled_athletes.csv'))
    df_ath_luge  = pd.read_csv(os.path.join(SAVE_DIR, 'luge_athletes.csv'))

    # ----------------------------------------------------------
    # 2. 종목별 전처리
    # ----------------------------------------------------------
    print('=' * 50)
    print('전처리 시작')
    print('=' * 50)

    df_skel_clean = preprocess_skeleton(df_skel, df_ath_skel)
    df_bob_clean  = preprocess_bobsled(df_bob)
    df_luge_clean = preprocess_luge(df_luge, df_ath_luge)

    # ----------------------------------------------------------
    # 3. 스켈레톤 모델 학습
    # ----------------------------------------------------------
    print('\n' + '=' * 50)
    print('스켈레톤 모델 학습')
    print('=' * 50)

    skel_features = ['start_time', 'height_cm', 'weight_kg', 'BMI', 'air_temp', 'Air_Density', 'dewpoint_c',
                     'ice_zone1', 'ice_zone2', 'ice_zone3', 'ice_zone4', 'ice_zone5']

    train_xgboost(
        df_skel_clean,
        sport_name='skeleton',
        feature_cols=skel_features,
        cat_cols=['athlete_id'],
        model_filename='skeleton_xgboost_model.pkl'
    )
    train_mlr(df_skel_clean, '스켈레톤', skel_features)

    # ----------------------------------------------------------
    # 4. 봅슬레이 모델 학습
    # ----------------------------------------------------------
    print('\n' + '=' * 50)
    print('봅슬레이 모델 학습')
    print('=' * 50)

    bob_features = ['start_time', 'air_temp', 'Air_Density', 'dewpoint_c', 'temp_avg']

    train_xgboost(
        df_bob_clean,
        sport_name='bobsled',
        feature_cols=bob_features,
        cat_cols=['pilot'],
        model_filename='bobsled_xgboost_model.pkl'
    )
    train_mlr(df_bob_clean, '봅슬레이', bob_features)

    # ----------------------------------------------------------
    # 5. 루지 모델 학습 (전체 통합)
    # ----------------------------------------------------------
    print('\n' + '=' * 50)
    print('루지 모델 학습 (통합)')
    print('=' * 50)

    luge_features = ['start_time', 'height_cm', 'weight_kg', 'air_temp', 'Air_Density', 'dewpoint_c']

    train_xgboost(
        df_luge_clean,
        sport_name='luge',
        feature_cols=luge_features,
        cat_cols=['athlete_id', 'Start_Location'],
        model_filename='luge_xgboost_model.pkl'
    )

    # ----------------------------------------------------------
    # 6. 루지 성별 분리 모델 (레이디 스타트 구간)
    # ----------------------------------------------------------
    print('\n' + '=' * 50)
    print('루지 레이디 스타트 - 성별 분리 모델')
    print('=' * 50)

    df_lady = df_luge_clean[df_luge_clean['Start_Location'] == 'Lady Start'].copy()

    # 특성 공학: 물리적 파생변수 추가
    df_lady['Power_Index'] = df_lady['weight_kg'] / df_lady['start_time']
    df_lady['Env_Stress']  = df_lady['Air_Density'] * df_lady['air_temp']

    lady_features_ext = luge_features + ['Power_Index', 'Env_Stress']

    df_lady_male   = df_lady[df_lady['gender'] == 'M'].copy()
    df_lady_female = df_lady[df_lady['gender'] == 'W'].copy()

    print(f'  남자(M): {len(df_lady_male)}건 / 여자(W): {len(df_lady_female)}건')

    train_xgboost(
        df_lady_male,
        sport_name='luge_lady_male',
        feature_cols=lady_features_ext,
        cat_cols=['athlete_id'],
        model_filename='luge_lady_male_xgboost.pkl'
    )
    train_xgboost(
        df_lady_female,
        sport_name='luge_lady_female',
        feature_cols=lady_features_ext,
        cat_cols=['athlete_id'],
        model_filename='luge_lady_female_xgboost.pkl'
    )
    train_mlr(df_lady_female, '루지 레이디(여)', lady_features_ext)

    # ----------------------------------------------------------
    # 완료
    # ----------------------------------------------------------
    print('\n' + '=' * 50)
    print('모든 모델 학습 완료')
    print(f'저장 위치: {SAVE_DIR}')
    print('생성된 모델 파일:')
    for fname in [
        'skeleton_xgboost_model.pkl',
        'bobsled_xgboost_model.pkl',
        'luge_xgboost_model.pkl',
        'luge_lady_male_xgboost.pkl',
        'luge_lady_female_xgboost.pkl',
    ]:
        path = os.path.join(SAVE_DIR, fname)
        status = '존재' if os.path.exists(path) else '없음'
        print(f'  {fname}: {status}')
    print('=' * 50)


if __name__ == '__main__':
    main()
