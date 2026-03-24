"""
XGBoost 스켈레톤 예측 모델 재학습 스크립트 v3.0
- Supabase에서 skeleton_records + athletes + ice_zone_temps 가져오기
- 5구간 빙면온도(ice_zone1~5) 적용 (44개 센서 데이터 기반)
- SHAP 변수 중요도 분석 (XAI)
- 시계열 교차검증 (TimeSeriesSplit)
- 변수 제거 실험 (Ablation Study)
- JS 추론용 모델 파일 생성
"""

import sys
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

import json
import math
import os
import requests
import numpy as np
import pandas as pd
import shap
from xgboost import XGBRegressor
from sklearn.model_selection import cross_val_score, GridSearchCV, KFold, TimeSeriesSplit
from sklearn.metrics import r2_score, mean_squared_error, mean_absolute_error

# ── Supabase 설정 ──
SUPABASE_URL = 'https://dxaehcocrbvhatyfmrvp.supabase.co'
SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4YWVoY29jcmJ2aGF0eWZtcnZwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTk0MDAxNywiZXhwIjoyMDg3NTE2MDE3fQ.VVnZrN6hfAeMxKZ5i3-_iUAjPzo8xvgkRbEfonYT2wM'

HEADERS = {
    'apikey': SUPABASE_KEY,
    'Authorization': f'Bearer {SUPABASE_KEY}',
}


def fetch_all(table, select='*', order='id'):
    """Supabase에서 페이지네이션으로 전체 데이터 가져오기"""
    rows = []
    limit = 1000
    offset = 0
    while True:
        url = f"{SUPABASE_URL}/rest/v1/{table}?select={select}&order={order}&offset={offset}&limit={limit}"
        resp = requests.get(url, headers=HEADERS)
        resp.raise_for_status()
        batch = resp.json()
        if not batch:
            break
        rows.extend(batch)
        offset += limit
    return rows


def calc_dewpoint(t, rh):
    """이슬점 계산 (Magnus formula)"""
    if t is None or rh is None or rh <= 0:
        return None
    a, b = 17.27, 237.7
    alpha = (a * t) / (b + t) + math.log(rh / 100.0)
    return (b * alpha) / (a - alpha)


def prepare_data():
    """데이터 로드 및 전처리 (5구간 빙면온도 포함)"""
    print("▶ Supabase에서 데이터 로드 중...")
    records = fetch_all('skeleton_records',
        'id,date,session,gender,format,nat,name,run,status,start_time,int1,int2,int3,int4,finish,speed,athlete_id,air_temp,humidity_pct,pressure_hpa,wind_speed_ms,dewpoint_c,ice_temp_est,temp_avg,is_normal')
    athletes = fetch_all('athletes',
        'athlete_id,name,nat,gender,height_cm,weight_kg,birth_year')

    # 5구간 빙면온도 로드
    ice_zones_raw = fetch_all('ice_zone_temps', 'date,ice_zone1,ice_zone2,ice_zone3,ice_zone4,ice_zone5', order='date')
    ice_df = pd.DataFrame(ice_zones_raw)

    df = pd.DataFrame(records)
    ath_df = pd.DataFrame(athletes)

    print(f"  전체 레코드: {len(df)}건, 선수: {len(ath_df)}명, 빙면온도: {len(ice_df)}일")

    # ── 정교한 전처리 파이프라인 (train_pipeline.py 동일) ──

    # 제외 선수 5명
    DROP_NAMES = ['PARK Yewoon', 'TORRES QUEVEDO Ana', 'RODRIGUEZ Adrian',
                  'JEONG Yeyeon', 'LEE Seunghoon']
    df = df[~df['name'].isin(DROP_NAMES)].copy()

    # TAKAHASHI Hiroatsu 국적 통일
    df.loc[df['name'] == 'TAKAHASHI Hiroatsu', 'nat'] = 'JPN'

    # 정상완주 필터링 (is_normal 또는 status=OK)
    df['is_normal'] = df['is_normal'].astype(str).str.strip().str.lower()
    valid_flags = ['1', '1.0', 'true', 't', 'y', 'yes']
    df = df[df['is_normal'].isin(valid_flags)].copy()

    df = df.dropna(subset=['finish', 'start_time'])
    df['finish'] = pd.to_numeric(df['finish'], errors='coerce')
    df['start_time'] = pd.to_numeric(df['start_time'], errors='coerce')
    for col in ['int1', 'int2', 'int3', 'int4', 'speed',
                'temp_avg', 'air_temp', 'humidity_pct', 'pressure_hpa',
                'wind_speed_ms', 'dewpoint_c', 'ice_temp_est']:
        df[col] = pd.to_numeric(df[col], errors='coerce')

    # finish < 50초 제거 (주니어스타트 이상치)
    before = len(df)
    df = df[df['finish'] >= 50.0]
    print(f"  finish < 50초 제거: {before - len(df)}건")

    # start_time < 4.5초 제거
    before = len(df)
    df = df[df['start_time'] >= 4.5]
    print(f"  start < 4.5초 제거: {before - len(df)}건")

    # 선수별 최고 start_time + 0.6초 초과 제거
    start_best = df.groupby('name')['start_time'].min().rename('start_best')
    df = df.join(start_best, on='name')
    before = len(df)
    df = df[df['start_time'] <= df['start_best'] + 0.6].copy()
    df.drop(columns=['start_best'], inplace=True)
    print(f"  start +0.6초 초과 제거: {before - len(df)}건")

    # 선수별 평균 speed - 5km/h 미만 제거
    speed_mean = df.groupby('name')['speed'].mean().rename('speed_mean')
    df = df.join(speed_mean, on='name')
    before = len(df)
    df = df[df['speed'] >= df['speed_mean'] - 5].copy()
    df.drop(columns=['speed_mean'], inplace=True)
    print(f"  speed 평균-5 미만 제거: {before - len(df)}건")

    # finish 상한선 (정장환 54.5초, 송영민 54.5초)
    FINISH_CAP = {'JUNG Janghwan': 54.5, 'SONG Youngmin': 54.5}
    for player, cap in FINISH_CAP.items():
        before = len(df)
        df = df[~((df['name'] == player) & (df['finish'] > cap))]
        removed = before - len(df)
        if removed > 0:
            print(f"  {player} finish > {cap}초 제거: {removed}건")

    # 유지 선수: athletes 테이블에서 동적으로 가져오되, 제외 선수 제거
    KEEP_IDS = set(ath_df['athlete_id'].dropna()) - {
        a for a, n in zip(ath_df['athlete_id'], ath_df['name']) if n in DROP_NAMES
    }
    # 데이터가 부족한 선수(주행 5건 미만)도 NULL 처리
    run_counts = df['athlete_id'].value_counts()
    low_data_ids = set(run_counts[run_counts < 5].index)
    KEEP_IDS = KEEP_IDS - low_data_ids
    null_count = df['athlete_id'].notna().sum() - df['athlete_id'].isin(KEEP_IDS).sum()
    df.loc[~df['athlete_id'].isin(KEEP_IDS), 'athlete_id'] = None
    print(f"  athlete_id 유지: {len(KEEP_IDS)}명, NULL 처리: {null_count}건")
    print(f"  전처리 후: {len(df)}건")

    # 성별 인코딩
    df['is_female'] = (df['gender'] == 'W').astype(int)

    # 선수 정보 병합
    if 'athlete_id' in df.columns and len(ath_df) > 0:
        ath_merge = ath_df[['athlete_id', 'height_cm', 'weight_kg']].copy()
        df = df.merge(ath_merge, on='athlete_id', how='left')

    # 5구간 빙면온도 매핑
    if len(ice_df) > 0:
        for zone in ['ice_zone1', 'ice_zone2', 'ice_zone3', 'ice_zone4', 'ice_zone5']:
            ice_df[zone] = pd.to_numeric(ice_df[zone], errors='coerce')
        zone_map = ice_df.set_index('date')
        for zone in ['ice_zone1', 'ice_zone2', 'ice_zone3', 'ice_zone4', 'ice_zone5']:
            df[zone] = df['date'].map(zone_map[zone].to_dict())
            # fallback: zone 없으면 temp_avg
            mask = df[zone].isna() & df['temp_avg'].notna()
            df.loc[mask, zone] = df.loc[mask, 'temp_avg']
        zone_valid = df['ice_zone1'].notna().sum()
        print(f"  5구간 빙면온도 매핑: {zone_valid}건 유효")

    # 파생 변수
    df['bmi'] = df['weight_kg'] / (df['height_cm']/100)**2
    df['month'] = pd.to_datetime(df['date']).dt.month
    df['day_of_season'] = (pd.to_datetime(df['date']) - pd.Timestamp('2025-10-01')).dt.days
    def _ad(t, p, rh):
        if t is None or p is None or rh is None or pd.isna(t) or pd.isna(p) or pd.isna(rh): return None
        es = 6.1078 * 10**(7.5*t/(237.3+t))
        pv = es * rh / 100
        return ((p - pv) * 100 / (287.05 * (t+273.15))) + (pv * 100 / (461.495 * (t+273.15)))
    df['air_density'] = df.apply(lambda r: _ad(r.get('air_temp'), r.get('pressure_hpa'), r.get('humidity_pct')), axis=1)

    # 날짜순 정렬 (시계열 CV용)
    df = df.sort_values('date').reset_index(drop=True)

    return df, ath_df


def train_pre_model(df):
    """Pre-race 모델 학습 (경기 전 예측)"""
    print("\n" + "="*60)
    print("▶ Pre-race XGBoost 모델 학습")
    print("="*60)

    # 피처 정의 v3: 5구간 빙면온도(ice_zone1~5) 적용
    feature_cols = ['start_time', 'ice_zone1', 'ice_zone2', 'ice_zone3', 'ice_zone4', 'ice_zone5',
                    'air_temp', 'humidity_pct', 'pressure_hpa', 'dewpoint_c', 'wind_speed_ms',
                    'is_female', 'height_cm', 'weight_kg', 'bmi', 'month', 'day_of_season', 'air_density']

    feature_labels = {
        'start_time': '스타트 시간',
        'ice_zone1': '빙면온도 Z1 (Start→Int.1)',
        'ice_zone2': '빙면온도 Z2 (Int.1→Int.2)',
        'ice_zone3': '빙면온도 Z3 (Int.2→Int.3)',
        'ice_zone4': '빙면온도 Z4 (Int.3→Int.4)',
        'ice_zone5': '빙면온도 Z5 (Int.4→Finish)',
        'air_temp': '기온',
        'humidity_pct': '습도',
        'pressure_hpa': '현지기압',
        'dewpoint_c': '이슬점',
        'wind_speed_ms': '풍속',
        'is_female': '여성 여부',
        'height_cm': '키',
        'weight_kg': '체중',
        'bmi': 'BMI',
        'month': '월',
        'day_of_season': '시즌일차',
        'air_density': '공기밀도',
    }

    # 결측치 제거
    work = df.dropna(subset=feature_cols + ['finish']).copy()
    X = work[feature_cols].values
    y = work['finish'].values

    print(f"  학습 데이터: {len(X)}건, 피처: {feature_cols}")

    # ── 1단계: 선수 ID 변수 중요도 점검 ──
    print("\n── 선수 ID 변수 중요도 점검 ──")

    # athlete_id를 범주형 인코딩하여 테스트
    if 'athlete_id' in work.columns:
        work_id = work.copy()
        # 빈도 기반 인코딩 (label encoding)
        id_map = {aid: i for i, aid in enumerate(work_id['athlete_id'].unique())}
        work_id['athlete_id_enc'] = work_id['athlete_id'].map(id_map)

        X_with_id = work_id[feature_cols + ['athlete_id_enc']].values
        y_id = work_id['finish'].values

        # Quick test
        model_with_id = XGBRegressor(
            n_estimators=100, max_depth=4, learning_rate=0.1,
            random_state=42, verbosity=0
        )
        cv_with_id = cross_val_score(model_with_id, X_with_id, y_id,
            cv=5, scoring='r2')

        model_without_id = XGBRegressor(
            n_estimators=100, max_depth=4, learning_rate=0.1,
            random_state=42, verbosity=0
        )
        cv_without_id = cross_val_score(model_without_id, X, y,
            cv=5, scoring='r2')

        print(f"  선수ID 포함 CV R²: {cv_with_id.mean():.4f} (±{cv_with_id.std():.4f})")
        print(f"  선수ID 제외 CV R²: {cv_without_id.mean():.4f} (±{cv_without_id.std():.4f})")

        # 선수ID 제외 (15피처 모델에서는 체중/키/BMI가 선수 특성 대체)
        print("  → 선수ID 제외 (체중/키/BMI로 대체)")
        id_map = None

    # ── 최적 파라미터 (사전 튜닝 완료) ──
    print("\n── 최적 파라미터 적용 ──")
    final_params = {
        'learning_rate': 0.05, 'max_depth': 4, 'min_child_weight': 10,
        'n_estimators': 500, 'colsample_bytree': 0.7, 'reg_alpha': 0.5,
        'reg_lambda': 1.0, 'subsample': 0.8, 'random_state': 42, 'verbosity': 0
    }
    print(f"\n── 최종 파라미터 ──")
    for k, v in final_params.items():
        if k not in ('random_state', 'verbosity'):
            print(f"  {k}: {v}")

    final_model = XGBRegressor(**final_params)
    final_model.fit(X, y)

    # 성능 평가
    y_pred = final_model.predict(X)
    train_r2 = r2_score(y, y_pred)
    train_rmse = mean_squared_error(y, y_pred) ** 0.5
    train_mae = mean_absolute_error(y, y_pred)

    cv_scores = cross_val_score(final_model, X, y, cv=5, scoring='r2')
    cv_r2 = cv_scores.mean()
    cv_std = cv_scores.std()

    cv_neg_mae = cross_val_score(final_model, X, y, cv=5, scoring='neg_mean_absolute_error')
    cv_mae = -cv_neg_mae.mean()

    print(f"\n── 최종 성능 ──")
    print(f"  Train R²:  {train_r2:.4f}")
    print(f"  CV R²:     {cv_r2:.4f} (±{cv_std:.4f})")
    print(f"  Train RMSE: {train_rmse:.4f}")
    print(f"  Train MAE:  {train_mae:.4f}")
    print(f"  CV MAE:     {cv_mae:.4f}")
    print(f"  과적합 갭:  {train_r2 - cv_r2:.4f} (이전: {0.7574 - 0.5965:.4f})")

    # 변수 중요도
    imp = dict(zip(feature_cols, final_model.feature_importances_.tolist()))
    print(f"\n── 변수 중요도 ──")
    for feat, score in sorted(imp.items(), key=lambda x: -x[1]):
        print(f"  {feature_labels.get(feat, feat):12s}: {score*100:.1f}%")

    return final_model, feature_cols, feature_labels, imp, {
        'n': len(X), 'train_r2': train_r2, 'cv_r2': cv_r2, 'cv_std': cv_std,
        'rmse': train_rmse, 'mae': train_mae, 'cv_mae': cv_mae,
        'params': {k: v for k, v in final_params.items() if k not in ('random_state', 'verbosity')},
    }, id_map if 'athlete_id_enc' in feature_cols else None


def train_live_model(df):
    """Live 모델 학습 (경기 중 구간 시간 포함)"""
    print("\n" + "="*60)
    print("▶ Live XGBoost 모델 학습 (구간 시간 포함)")
    print("="*60)

    feature_cols = ['start_time', 'int1', 'int2', 'int3', 'int4',
                    'temp_avg', 'air_temp', 'humidity_pct',
                    'pressure_hpa', 'dewpoint_c', 'wind_speed_ms', 'is_female']
    feature_labels = {
        'start_time': '스타트 시간', 'int1': 'Int.1', 'int2': 'Int.2',
        'int3': 'Int.3', 'int4': 'Int.4',
        'temp_avg': '얼음 온도', 'air_temp': '기온', 'humidity_pct': '습도',
        'pressure_hpa': '현지기압', 'dewpoint_c': '이슬점', 'wind_speed_ms': '풍속',
        'is_female': '여성 여부',
    }

    work = df.dropna(subset=feature_cols + ['finish']).copy()
    X = work[feature_cols].values
    y = work['finish'].values

    print(f"  학습 데이터: {len(X)}건")

    # Live 모델은 정보량이 많아 과적합 위험 낮음, 하지만 적당히 제어
    param_grid = {
        'n_estimators': [100, 200, 300],
        'max_depth': [4, 5, 6],
        'learning_rate': [0.05, 0.1],
        'min_child_weight': [3, 5],
        'subsample': [0.8, 0.9],
        'colsample_bytree': [0.8, 1.0],
        'reg_lambda': [1.0, 5.0],
    }

    gs = GridSearchCV(
        XGBRegressor(random_state=42, verbosity=0),
        param_grid, cv=5, scoring='r2', n_jobs=-1, refit=True
    )
    gs.fit(X, y)

    final_model = gs.best_estimator_
    print(f"  최적 파라미터: {gs.best_params_}")

    y_pred = final_model.predict(X)
    train_r2 = r2_score(y, y_pred)
    train_rmse = mean_squared_error(y, y_pred) ** 0.5
    train_mae = mean_absolute_error(y, y_pred)
    cv_r2 = gs.best_score_
    cv_scores = cross_val_score(final_model, X, y, cv=5, scoring='r2')
    cv_std = cv_scores.std()

    print(f"  Train R²:  {train_r2:.4f}")
    print(f"  CV R²:     {cv_r2:.4f} (±{cv_std:.4f})")
    print(f"  Train RMSE: {train_rmse:.4f}")
    print(f"  CV MAE:     {train_mae:.4f}")

    imp = dict(zip(feature_cols, final_model.feature_importances_.tolist()))
    print(f"\n── 변수 중요도 ──")
    for feat, score in sorted(imp.items(), key=lambda x: -x[1]):
        print(f"  {feature_labels.get(feat, feat):12s}: {score*100:.1f}%")

    return final_model, feature_cols, feature_labels, imp, {
        'n': len(X), 'train_r2': train_r2, 'cv_r2': cv_r2, 'cv_std': cv_std,
        'rmse': train_rmse, 'mae': train_mae,
        'params': {k: v for k, v in gs.best_params_.items()},
    }


def model_to_js_trees(model):
    """XGBoost 모델을 JS 추론용 트리 배열로 변환"""
    booster = model.get_booster()
    trees_str = booster.get_dump(dump_format='json')
    js_trees = []

    def parse_tree(node):
        """트리 노드를 [feature_idx, threshold, right_child_idx, leaf_value] 형식으로 변환"""
        nodes = []

        def traverse(n, idx=0):
            if 'leaf' in n:
                nodes.append([-1, 0, 0, round(n['leaf'], 8)])
                return idx
            feat_idx = int(n['split'][1:]) if n['split'].startswith('f') else int(n['split'])
            threshold = round(n['split_condition'], 6)
            nodes.append([feat_idx, threshold, 0, 0])  # placeholder for right_child
            current_idx = idx

            # left child (yes)
            left_idx = len(nodes)
            traverse(n['children'][0], left_idx)

            # right child (no)
            right_idx = len(nodes)
            nodes[current_idx][2] = right_idx
            traverse(n['children'][1], right_idx)

            return current_idx

        traverse(json.loads(node))
        return nodes

    for tree_str in trees_str:
        js_trees.append(parse_tree(tree_str))

    return js_trees


def export_js(pre_model, pre_cols, pre_labels, pre_imp, pre_stats, pre_id_map,
              live_model, live_cols, live_labels, live_imp, live_stats):
    """JS 파일 생성"""
    print("\n" + "="*60)
    print("▶ JS 모델 파일 생성")
    print("="*60)

    pre_trees = model_to_js_trees(pre_model)
    live_trees = model_to_js_trees(live_model)

    # base_score: XGBoost 3.x extracts from booster config
    def get_base_score(model):
        try:
            config = json.loads(model.get_booster().save_config())
            bs_raw = config['learner']['learner_model_param']['base_score']
            # XGBoost 3.x returns "[5.43E1]" format — strip brackets
            bs_str = str(bs_raw).strip('[]')
            return float(bs_str)
        except:
            # fallback: use intercept_
            try:
                return float(model.intercept_[0] if hasattr(model.intercept_, '__len__') else model.intercept_)
            except:
                return 0.5

    pre_bs = get_base_score(pre_model)
    live_bs = get_base_score(live_model)

    # JS feature name mapping (match existing format)
    pre_f = pre_cols[:]
    pre_fl = [pre_labels.get(c, c) for c in pre_cols]
    live_f = live_cols[:]
    live_fl = [live_labels.get(c, c) for c in live_cols]

    model_obj = {
        'pre': {
            'bs': round(pre_bs, 6),
            'f': pre_f,
            'fl': pre_fl,
            'n': pre_stats['n'],
            'r2': round(pre_stats['train_r2'], 4),
            'cv': round(pre_stats['cv_r2'], 4),
            'rmse': round(pre_stats['rmse'], 4),
            'mae': round(pre_stats['mae'], 4),
            'imp': {k: round(v, 4) for k, v in pre_imp.items()},
            'id_map': pre_id_map,
            't': pre_trees,
        },
        'live': {
            'bs': round(live_bs, 6),
            'f': live_f,
            'fl': live_fl,
            'n': live_stats['n'],
            'r2': round(live_stats['train_r2'], 4),
            'cv': round(live_stats['cv_r2'], 4),
            'rmse': round(live_stats['rmse'], 4),
            'mae': round(live_stats['mae'], 4),
            'imp': {k: round(v, 4) for k, v in live_imp.items()},
            't': live_trees,
        }
    }

    # xgb-models.js
    js_content = "// XGBoost 모델 - Python 학습 → JS 추론 (자동 생성)\n"
    js_content += f"const XGB_MODELS={json.dumps(model_obj, separators=(',', ':'))};\n\n"
    js_content += """function xgbPredict(m, x) {
  let s = m.bs;
  for (const t of m.t) {
    let i = 0;
    while (true) {
      const n = t[i];
      if (n[0] === -1) {
        s += n[3];
        break;
      }
      if (x[n[0]] < n[1])
        i++;
      else
        i = n[2];
    }
  }
  return s;
}
"""

    js_path = 'web/src/js/xgb-models.js'
    with open(js_path, 'w', encoding='utf-8') as f:
        f.write(js_content)
    print(f"  → {js_path} ({len(js_content):,} chars)")

    # xgb_meta.json
    meta = {
        'pre': {
            'features': pre_f,
            'featureLabels': pre_fl,
            'trainN': pre_stats['n'],
            'trainR2': round(pre_stats['train_r2'], 4),
            'trainRMSE': round(pre_stats['rmse'], 4),
            'trainMAE': round(pre_stats['mae'], 4),
            'cvR2': round(pre_stats['cv_r2'], 4),
            'cvR2Std': round(pre_stats['cv_std'], 4),
            'importance': {k: round(v, 4) for k, v in pre_imp.items()},
            'params': pre_stats['params'],
        },
        'live': {
            'features': live_f,
            'featureLabels': live_fl,
            'trainN': live_stats['n'],
            'trainR2': round(live_stats['train_r2'], 4),
            'trainRMSE': round(live_stats['rmse'], 4),
            'trainMAE': round(live_stats['mae'], 4),
            'cvR2': round(live_stats['cv_r2'], 4),
            'cvR2Std': round(live_stats['cv_std'], 4),
            'importance': {k: round(v, 4) for k, v in live_imp.items()},
            'params': live_stats['params'],
        }
    }

    meta_path = 'web/src/js/xgb_meta.json'
    with open(meta_path, 'w', encoding='utf-8') as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)
    print(f"  → {meta_path}")

    return pre_stats, live_stats


def run_shap_analysis(model, X, feature_cols, feature_labels):
    """SHAP 변수 중요도 분석 (XAI)"""
    print("\n" + "="*60)
    print("▶ SHAP 변수 중요도 분석 (Explainable AI)")
    print("="*60)

    explainer = shap.TreeExplainer(model)
    shap_values = explainer.shap_values(X)
    mean_abs_shap = np.abs(shap_values).mean(axis=0)

    shap_result = dict(zip(feature_cols, mean_abs_shap))
    print("\n  변수별 평균 |SHAP| 값:")
    for feat, val in sorted(shap_result.items(), key=lambda x: -x[1]):
        label = feature_labels.get(feat, feat)
        bar = '█' * int(val / max(mean_abs_shap) * 25)
        print(f"    {label:<28s} {val:.4f}  {bar}")

    return shap_result


def run_timeseries_cv(df, feature_cols, n_splits=5):
    """시계열 교차검증 (TimeSeriesSplit) - 데이터 누수 방지"""
    print("\n" + "="*60)
    print(f"▶ 시계열 교차검증 (TimeSeriesSplit, n_splits={n_splits})")
    print("="*60)

    work = df.dropna(subset=feature_cols + ['finish']).copy()
    work = work.sort_values('date').reset_index(drop=True)
    X = work[feature_cols].values
    y = work['finish'].values

    tscv = TimeSeriesSplit(n_splits=n_splits)
    r2_scores, rmse_scores = [], []

    for fold, (train_idx, test_idx) in enumerate(tscv.split(X)):
        model = XGBRegressor(
            max_depth=4, learning_rate=0.05, n_estimators=500,
            min_child_weight=10, subsample=0.8, colsample_bytree=0.7,
            reg_alpha=0.5, reg_lambda=1.0, random_state=42, verbosity=0
        )
        model.fit(X[train_idx], y[train_idx])
        y_pred = model.predict(X[test_idx])
        r2 = r2_score(y[test_idx], y_pred)
        rmse = mean_squared_error(y[test_idx], y_pred) ** 0.5
        r2_scores.append(r2)
        rmse_scores.append(rmse)
        print(f"  Fold {fold+1} | train={len(train_idx):4d} test={len(test_idx):3d} | "
              f"R²={r2*100:6.2f}%  RMSE={rmse:.4f}s")

    print(f"  → 평균 R²={np.mean(r2_scores)*100:.2f}% ± {np.std(r2_scores)*100:.2f}%  "
          f"RMSE={np.mean(rmse_scores):.4f}s ± {np.std(rmse_scores):.4f}s")

    return {
        'r2_mean': np.mean(r2_scores), 'r2_std': np.std(r2_scores),
        'rmse_mean': np.mean(rmse_scores), 'rmse_std': np.std(rmse_scores),
        'fold_r2s': r2_scores,
    }


def run_ablation_study(df, feature_cols, feature_labels):
    """변수 제거 실험 (Ablation Study)"""
    print("\n" + "="*60)
    print("▶ 변수 제거 실험 (Ablation Study)")
    print("="*60)

    work = df.dropna(subset=feature_cols + ['finish']).copy()
    work = work.sort_values('date').reset_index(drop=True)
    X_full = work[feature_cols].values
    y = work['finish'].values

    tscv = TimeSeriesSplit(n_splits=5)

    def cv_r2(X_in):
        scores = []
        for tr, te in tscv.split(X_in):
            m = XGBRegressor(max_depth=4, learning_rate=0.05, n_estimators=500,
                             min_child_weight=10, subsample=0.8, random_state=42, verbosity=0)
            m.fit(X_in[tr], y[tr])
            scores.append(r2_score(y[te], m.predict(X_in[te])))
        return np.mean(scores)

    base_r2 = cv_r2(X_full)
    print(f"  기준선 ({len(feature_cols)}개 변수): R²={base_r2*100:.2f}%\n")

    ablation = {}
    for i, feat in enumerate(feature_cols):
        X_reduced = np.delete(X_full, i, axis=1)
        abl_r2 = cv_r2(X_reduced)
        drop = (base_r2 - abl_r2) * 100
        ablation[feat] = {'r2': abl_r2, 'drop': drop}
        label = feature_labels.get(feat, feat)
        direction = '▼' if drop > 0 else '▲'
        print(f"  - {label:<28s} 제거 시 R²={abl_r2*100:.2f}%  ({direction}{abs(drop):.2f}%p)")

    return ablation


def main():
    df, ath_df = prepare_data()

    # Pre-race 모델
    pre_model, pre_cols, pre_labels, pre_imp, pre_stats, pre_id_map = train_pre_model(df)

    # Live 모델
    live_model, live_cols, live_labels, live_imp, live_stats = train_live_model(df)

    # JS 파일 생성
    export_js(pre_model, pre_cols, pre_labels, pre_imp, pre_stats, pre_id_map,
              live_model, live_cols, live_labels, live_imp, live_stats)

    # ── XAI 분석 (Pre-race 모델) ──
    work = df.dropna(subset=pre_cols + ['finish']).copy()
    X_shap = work[pre_cols].values
    shap_result = run_shap_analysis(pre_model, X_shap, pre_cols, pre_labels)
    ts_cv_result = run_timeseries_cv(df, pre_cols)
    ablation_result = run_ablation_study(df, pre_cols, pre_labels)

    # ── 최종 비교 ──
    print("\n" + "="*60)
    print("▶ 이전 모델 vs 새 모델 비교")
    print("="*60)
    print(f"  {'':28s} {'이전':>10s} {'v3.0':>10s}")
    print(f"  {'─'*50}")
    print(f"  {'Pre-race Train R²':28s} {'0.7574':>10s} {pre_stats['train_r2']:>10.4f}")
    print(f"  {'Pre-race CV R² (KFold)':28s} {'0.5965':>10s} {pre_stats['cv_r2']:>10.4f}")
    print(f"  {'Pre-race CV R² (TimeSeries)':28s} {'N/A':>10s} {ts_cv_result['r2_mean']:>10.4f}")
    print(f"  {'Pre-race RMSE':28s} {'0.7508':>10s} {pre_stats['rmse']:>10.4f}")
    print(f"  {'과적합 갭':28s} {'0.1609':>10s} {pre_stats['train_r2']-pre_stats['cv_r2']:>10.4f}")
    print(f"  {'─'*50}")
    print(f"  {'Live Train R²':28s} {'0.9989':>10s} {live_stats['train_r2']:>10.4f}")
    print(f"  {'Live CV R²':28s} {'0.9727':>10s} {live_stats['cv_r2']:>10.4f}")

    # SHAP TOP 5
    print(f"\n▶ SHAP 변수 중요도 TOP 5:")
    for i, (feat, val) in enumerate(sorted(shap_result.items(), key=lambda x: -x[1])[:5], 1):
        print(f"  {i}. {pre_labels.get(feat, feat)}: {val:.4f}")

    print()
    print("✅ v3.0 완료! (5구간 빙면온도 + SHAP + 시계열 CV + Ablation)")


if __name__ == '__main__':
    main()
