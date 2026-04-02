"""
루지 v4 모델 → 프론트엔드 JSON 내보내기 + xgb-models.js 갱신
- 국제대회 여자 싱글 데이터 포함
- 기상 데이터 완비 (Open-Meteo)
- 신체 데이터 결측 median 대체
"""
import sys, os, json
sys.stdout.reconfigure(encoding='utf-8')
import numpy as np
import pandas as pd
import joblib
from xgboost import XGBRegressor
from sklearn.model_selection import train_test_split, KFold, cross_val_score
from sklearn.metrics import r2_score, mean_squared_error, mean_absolute_error

BASE_DIR = r'C:\Users\Admin\Desktop\박사논문\예측모델'
SAVE_DIR = r'C:\Users\Admin\Desktop\새 폴더'
WEB_JS = os.path.join(BASE_DIR, 'web', 'src', 'js')

LUGE_DROP_NAMES = ['배하영', 'BAE Hayoung']  # 배재성은 v5부터 포함

# ============================================================
# 1. 데이터 로드 + 전처리 (v4: 국제대회 포함 + 결측 대체)
# ============================================================
print("1. 데이터 로드 및 전처리 (v4)")

df_raw = pd.read_csv(os.path.join(BASE_DIR, 'luge_records.csv'))
df_ath = pd.read_csv(os.path.join(BASE_DIR, 'luge_athletes.csv'))

df = df_raw.copy()
for c in ['start_time', 'finish', 'int1', 'int2', 'int3', 'int4', 'speed']:
    df[c] = pd.to_numeric(df[c], errors='coerce')
for c in ['air_temp', 'pressure_hpa', 'dewpoint_c', 'humidity_pct', 'wind_speed_ms', 'temp_avg']:
    df[c] = pd.to_numeric(df.get(c, pd.Series(dtype=float)), errors='coerce')

# Lady Start
df = df[(df['start_time'] >= 4.0) & (df['start_time'] <= 5.0)]
df['is_normal'] = df['is_normal'].astype(str).str.lower()
df = df[df['is_normal'].isin(['true', '1', '1.0'])].copy()
df = df.dropna(subset=['finish', 'start_time'])
df = df[~df['name'].isin(LUGE_DROP_NAMES)]
df = df[(df['finish'] >= 46) & (df['finish'] <= 54)]
df = df[(df['speed'].isna()) | (df['speed'] >= 90)]

# 성별
df['gender'] = df['gender'].astype(str).str.strip().str.upper()
df['is_female'] = (df['gender'] == 'W').astype(int)

# 신체 데이터 병합
df = pd.merge(df, df_ath[['athlete_id', 'height_cm', 'weight_kg']].drop_duplicates('athlete_id'),
              on='athlete_id', how='left', suffixes=('', '_ath'))
for c in ['height_cm', 'weight_kg']:
    if c + '_ath' in df.columns:
        df[c] = df[c].fillna(df[c + '_ath'])
    df[c] = pd.to_numeric(df[c], errors='coerce')

# 기상 결측 제거 (API로 받아온 데이터 반영됨)
df = df.dropna(subset=['air_temp', 'pressure_hpa', 'dewpoint_c'])

# 파생 변수
df['Air_Density'] = (df['pressure_hpa'] * 100) / (287.05 * (df['air_temp'] + 273.15))

# 신체 결측 median 대체
for c in ['height_cm', 'weight_kg']:
    med = df[c].median()
    df[c] = df[c].fillna(med)
df['BMI'] = df['weight_kg'] / ((df['height_cm'] / 100) ** 2)

# start +0.3초 필터
best_start = df.groupby('name')['start_time'].min()
df = df[df.apply(lambda r: r['start_time'] <= best_start.get(r['name'], 999) + 0.3, axis=1)]

# ice_zone fallback
for c in ['temp_avg']:
    df[c] = df[c].fillna(df[c].median())
for z in ['ice_zone1', 'ice_zone2', 'ice_zone3', 'ice_zone4', 'ice_zone5']:
    df[z] = df['temp_avg']

# 기상 결측 대체
for c in ['humidity_pct', 'wind_speed_ms']:
    df[c] = df[c].fillna(df[c].median())

# 파생변수
df['dew_minus_ice'] = df['dewpoint_c'] - df['temp_avg']
df['frost_risk'] = (df['dew_minus_ice'] > 0).astype(int)
df['ice_mean'] = df['temp_avg']
df['start_x_weight'] = df['start_time'] * df['weight_kg']
df['start_x_density'] = df['start_time'] * df['Air_Density']
df['weight_x_density'] = df['weight_kg'] * df['Air_Density']
df['dew_x_ice_mean'] = df['dewpoint_c'] * df['ice_mean']
df['start_time_sq'] = df['start_time'] ** 2
df['dewpoint_sq'] = df['dewpoint_c'] ** 2

df['date'] = pd.to_datetime(df['date'], errors='coerce')
df = df.sort_values('date').reset_index(drop=True)
print(f"  최종: {len(df)}건, {df['name'].nunique()}명")
print(f"  남자: {len(df[df['gender']=='M'])} / 여자: {len(df[df['gender']=='W'])}")

# ============================================================
# 2. 피처 정의 + 모델 학습
# ============================================================
print("\n2. 모델 학습 (v4)")

base_features = ['start_time', 'height_cm', 'weight_kg', 'BMI',
                 'air_temp', 'Air_Density', 'dewpoint_c', 'temp_avg',
                 'ice_zone1', 'ice_zone2', 'ice_zone3', 'ice_zone4', 'ice_zone5',
                 'is_female', 'humidity_pct', 'wind_speed_ms']

derived_features = ['dew_minus_ice', 'frost_risk', 'ice_mean',
                    'start_x_weight', 'start_x_density', 'weight_x_density',
                    'dew_x_ice_mean', 'start_time_sq', 'dewpoint_sq']

all_features = base_features + derived_features

feature_labels = {
    'start_time': '스타트 시간', 'height_cm': '키(cm)', 'weight_kg': '체중(kg)',
    'BMI': 'BMI', 'air_temp': '기온(°C)', 'Air_Density': '공기밀도',
    'dewpoint_c': '이슬점(°C)', 'temp_avg': '빙면평균온도',
    'ice_zone1': '빙면온도 Z1', 'ice_zone2': '빙면온도 Z2',
    'ice_zone3': '빙면온도 Z3', 'ice_zone4': '빙면온도 Z4',
    'ice_zone5': '빙면온도 Z5', 'is_female': '여성',
    'humidity_pct': '습도(%)', 'wind_speed_ms': '풍속(m/s)',
    'dew_minus_ice': '이슬점-빙면차', 'frost_risk': '서리위험',
    'ice_mean': '빙면평균', 'start_x_weight': '스타트×체중',
    'start_x_density': '스타트×공기밀도', 'weight_x_density': '체중×공기밀도',
    'dew_x_ice_mean': '이슬점×빙면평균', 'start_time_sq': '스타트²',
    'dewpoint_sq': '이슬점²',
}

# OHE athlete_id
df_enc = pd.get_dummies(df, columns=['athlete_id'], drop_first=True)
ohe_cols = [c for c in df_enc.columns if 'athlete_id_' in c]

# id_map for frontend
id_map = {}
for c in ohe_cols:
    aid = c.replace('athlete_id_', '')
    match = df[df['athlete_id'] == aid]
    if len(match) > 0:
        id_map[aid] = match.iloc[0]['name']

all_cols = all_features + ohe_cols
all_cols = [f for f in all_cols if f in df_enc.columns]

X = df_enc[all_cols].astype(float)
y = df_enc['finish'].astype(float)
valid = X.notna().all(axis=1) & y.notna()
X, y = X[valid], y[valid]

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

model = XGBRegressor(max_depth=4, learning_rate=0.05, n_estimators=200,
                     subsample=0.8, colsample_bytree=0.8, random_state=42)
model.fit(X_train, y_train)
pred = model.predict(X_test)
r2 = r2_score(y_test, pred)
rmse = np.sqrt(mean_squared_error(y_test, pred))
mae = mean_absolute_error(y_test, pred)
print(f"  XGBoost v4 Test: R²={r2*100:.2f}%, RMSE={rmse:.4f}s, MAE={mae:.4f}s")

# KFold CV
kf = KFold(n_splits=5, shuffle=True, random_state=42)
cv_scores = cross_val_score(model, X, y, cv=kf, scoring='r2')
cv_r2 = cv_scores.mean()
cv_std = cv_scores.std()
print(f"  KFold CV: R²={cv_r2*100:.2f}% (±{cv_std*100:.2f}%)")

# Feature importance
importances = dict(zip(all_cols, model.feature_importances_))

# ============================================================
# 3. JSON 내보내기
# ============================================================
print("\n3. JSON 내보내기")

def model_to_js_trees(xgb_model):
    booster = xgb_model.get_booster()
    trees = []
    for i in range(xgb_model.n_estimators):
        dump = booster.get_dump(dump_format='json')[i]
        tree_json = json.loads(dump)
        nodes = []
        _parse_tree_node(tree_json, nodes, xgb_model)
        trees.append(nodes)
    return trees

def _parse_tree_node(node, nodes, model):
    idx = len(nodes)
    if 'leaf' in node:
        nodes.append([-1, 0, 0, round(node['leaf'], 6)])
        return idx
    feat_name = node['split']
    feat_idx = list(model.feature_names_in_).index(feat_name) if feat_name in model.feature_names_in_ else 0
    threshold = round(node['split_condition'], 6)
    nodes.append([feat_idx, threshold, 0, 0])
    left_idx = _parse_tree_node(node['children'][0], nodes, model)
    right_idx = _parse_tree_node(node['children'][1], nodes, model)
    nodes[idx][2] = right_idx
    return idx

trees = model_to_js_trees(model)

try:
    config = json.loads(model.get_booster().save_config())
    bs_raw = config['learner']['learner_model_param']['base_score']
    base_score = float(str(bs_raw).strip('[]'))
except:
    base_score = float(y.mean())

print(f"  Base score: {base_score:.6f}")
print(f"  Trees: {len(trees)}")
print(f"  Features: {len(all_cols)}")
print(f"  Athletes (OHE): {len(ohe_cols)}")

# 3a. xgb_luge_pre.json
pre_obj = {
    'bs': round(base_score, 6),
    'f': all_cols,
    'fl': [feature_labels.get(c, c) for c in all_cols],
    'n': int(len(X_train)),
    'r2': round(r2, 4),
    'cv': round(cv_r2, 4),
    'rmse': round(rmse, 4),
    'mae': round(mae, 4),
    'imp': {k: round(float(v), 4) for k, v in importances.items() if float(v) > 0.001},
    'id_map': id_map,
    't': trees,
}

pre_path = os.path.join(WEB_JS, 'xgb_luge_pre.json')
with open(pre_path, 'w', encoding='utf-8') as f:
    json.dump(pre_obj, f, separators=(',', ':'))
print(f"  → {pre_path} ({os.path.getsize(pre_path):,} bytes)")

# 3b. xgb_luge_meta.json
meta = {
    'pre': {
        'features': all_cols,
        'featureLabels': [feature_labels.get(c, c) for c in all_cols],
        'trainN': int(len(X_train)),
        'trainR2': round(r2, 4),
        'trainRMSE': round(rmse, 4),
        'trainMAE': round(mae, 4),
        'cvR2': round(cv_r2, 4),
        'cvR2Std': round(cv_std, 4),
        'importance': {k: round(float(v), 4) for k, v in importances.items() if float(v) > 0.001},
        'params': {
            'max_depth': 4, 'learning_rate': 0.05,
            'n_estimators': 200, 'subsample': 0.8
        },
        'dataNote': '국제대회 여자 싱글 + cleaned 보강 + 배재성 포함 (v5)',
    }
}

meta_path = os.path.join(WEB_JS, 'xgb_luge_meta.json')
with open(meta_path, 'w', encoding='utf-8') as f:
    json.dump(meta, f, indent=2, ensure_ascii=False)
print(f"  → {meta_path}")

# 3c. xgb-models.js 갱신
xgb_models_path = os.path.join(WEB_JS, 'xgb-models.js')
if os.path.exists(xgb_models_path):
    with open(xgb_models_path, 'r', encoding='utf-8') as f:
        js_content = f.read()

    start_marker = 'const XGB_MODELS='
    end_marker = '};\nfunction xgbPredict'

    start_idx = js_content.find(start_marker)
    end_idx = js_content.find(end_marker)

    if start_idx >= 0 and end_idx >= 0:
        json_str = js_content[start_idx + len(start_marker):end_idx]
        try:
            models_obj = json.loads(json_str)
            print(f"  기존 xgb-models.js 파싱 성공 (keys: {list(models_obj.keys())})")
            models_obj['luge'] = {'pre': pre_obj}
            header = js_content[:start_idx]
            footer = js_content[end_idx:]
            new_js = header + start_marker + json.dumps(models_obj, separators=(',', ':')) + footer
            with open(xgb_models_path, 'w', encoding='utf-8') as f:
                f.write(new_js)
            print(f"  → {xgb_models_path} 갱신 완료 ({len(new_js):,} chars)")
        except json.JSONDecodeError as e:
            print(f"  xgb-models.js JSON 파싱 실패: {e}")
    else:
        print(f"  xgb-models.js 마커 찾기 실패")
else:
    print(f"  xgb-models.js 없음")

# 3d. pkl 저장
joblib.dump(model, os.path.join(SAVE_DIR, 'luge_xgboost_v4_export.pkl'))
print(f"  → {SAVE_DIR}/luge_xgboost_v4_export.pkl")

# ============================================================
# 4. 완료 요약
# ============================================================
print("\n" + "=" * 60)
print("루지 v4 모델 내보내기 완료")
print("=" * 60)
print(f"  v3 → v4 변경사항:")
print(f"    데이터: 244건 → {len(X)}건 ({len(X)-244:+d}건)")
print(f"    선수: 8명 → {df['name'].nunique()}명")
print(f"    R² (CV): 71.62% → {cv_r2*100:.2f}%")
print(f"    RMSE: 0.5461s → {rmse:.4f}s")
print(f"  신규 국제대회: WC/NC 2017, OWG 2018, ACh/NC 2025")
print(f"  기상 데이터: Open-Meteo API 적용")
print(f"\n  갱신 파일:")
print(f"    {pre_path}")
print(f"    {meta_path}")
print(f"    {xgb_models_path}")
