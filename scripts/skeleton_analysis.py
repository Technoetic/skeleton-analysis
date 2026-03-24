"""
skeleton_analysis.py
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
스켈레톤 주행기록 예측 모델 분석 (박사논문용)
  1. 시계열 교차검증 (TimeSeriesSplit)
  2. 모델 비교: XGBoost vs Random Forest vs SVR vs MLR
  3. SHAP 변수 중요도 분석 + 시각화
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
import sys
sys.stdout.reconfigure(encoding='utf-8')

import warnings
warnings.filterwarnings('ignore')

import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.font_manager as fm

import xgboost as xgb
import shap

from sklearn.ensemble import RandomForestRegressor
from sklearn.svm import SVR
from sklearn.linear_model import LinearRegression
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import TimeSeriesSplit, cross_val_score
from sklearn.metrics import r2_score, mean_squared_error
from sklearn.pipeline import Pipeline

# ── 한글 폰트 설정 ──────────────────────────────────────────
def set_korean_font():
    candidates = [
        'Malgun Gothic', 'NanumGothic', 'AppleGothic',
        'NanumBarunGothic', 'Dotum'
    ]
    available = {f.name for f in fm.fontManager.ttflist}
    for c in candidates:
        if c in available:
            plt.rcParams['font.family'] = c
            break
    plt.rcParams['axes.unicode_minus'] = False

set_korean_font()

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 1. 데이터 로드 & 전처리 (train_pipeline과 동일 로직)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
print("=" * 60)
print("데이터 로드 및 전처리")
print("=" * 60)

import json

df_raw = pd.read_csv('skeleton_records.csv')
df_ath = pd.read_csv('athletes.csv')
with open('ice_zone_temps.json', 'r') as f:
    zone_temps = json.load(f)

SKEL_DROP_NAMES = [
    'PARK Yewoon', 'TORRES QUEVEDO Ana', 'RODRIGUEZ Adrian',
    'JEONG Yeyeon', 'LEE Seunghoon'
]
# athlete_id 유지 선수는 athletes 테이블에서 동적으로 결정 (DROP 제외 + 주행 5건 이상)

def preprocess(df_raw, df_ath):
    df = df_raw.copy()
    # 제외 선수
    df = df[~df['name'].isin(SKEL_DROP_NAMES)]
    # 국적 통일
    df.loc[df['name'] == 'TAKAHASHI Hiroatsu', 'nat'] = 'JPN'
    # 정상완주
    df = df[df['is_normal'] == True].copy()
    # 신체 데이터 병합
    df = pd.merge(df, df_ath[['athlete_id','height_cm','weight_kg']], on='athlete_id', how='left')
    # 숫자 변환
    for col in ['start_time','finish','air_temp','pressure_hpa','dewpoint_c',
                'height_cm','weight_kg','temp_avg']:
        df[col] = pd.to_numeric(df[col], errors='coerce')
    # 핵심 결측치 제거 (temp_avg 포함)
    df = df.dropna(subset=['start_time','finish','air_temp','pressure_hpa',
                            'dewpoint_c','height_cm','weight_kg']).copy()
    # 공기밀도
    df['Air_Density'] = (df['pressure_hpa'] * 100) / (287.05 * (df['air_temp'] + 273.15))
    # BMI
    df['BMI'] = df['weight_kg'] / (df['height_cm'] / 100) ** 2
    # 이상치 제거
    df = df[df['finish'] >= 50].copy()
    df = df[df['start_time'] >= 4.5].copy()
    # 선수별 start_time 상한
    best_start = df.groupby('name')['start_time'].min()
    df = df[df.apply(lambda r: r['start_time'] <= best_start[r['name']] + 0.6, axis=1)]
    # 선수별 speed 하한
    mean_speed = df.groupby('name')['speed'].mean()
    df = df[df.apply(lambda r: pd.isna(r['speed']) or r['speed'] >= mean_speed.get(r['name'], 0) - 5, axis=1)]
    # finish 상한 (정장환/송영민)
    for name, cap in [('JUNG Janghwan', 54.5), ('SONG Youngmin', 54.5)]:
        df = df[~((df['name'] == name) & (df['finish'] > cap))]
    # athlete_id NULL 처리 (athletes 테이블에서 동적 결정, DROP 제외 + 주행 5건 이상)
    all_ids = set(df_ath['athlete_id'].dropna())
    drop_ids = set(df_ath.loc[df_ath['name'].isin(SKEL_DROP_NAMES), 'athlete_id'].dropna())
    run_counts = df['athlete_id'].value_counts()
    low_data = set(run_counts[run_counts < 5].index)
    keep_ids = all_ids - drop_ids - low_data
    df.loc[~df['athlete_id'].isin(keep_ids), 'athlete_id'] = None
    # 구간별 빙면 온도 매핑
    for zone in ['ice_zone1', 'ice_zone2', 'ice_zone3', 'ice_zone4', 'ice_zone5']:
        df[zone] = df['date'].map({d: v.get(zone) for d, v in zone_temps.items()})
        mask = df[zone].isna() & df['temp_avg'].notna()
        df.loc[mask, zone] = df.loc[mask, 'temp_avg']
    # 날짜순 정렬 (시계열 CV용)
    df = df.sort_values('date').reset_index(drop=True)
    return df

df = preprocess(df_raw, df_ath)
print(f"전처리 완료: {len(df)}건")
print(f"날짜 범위: {df['date'].min()} ~ {df['date'].max()}")
print(f"선수 수: {df['name'].nunique()}명")

FEATURES = ['start_time','height_cm','weight_kg','BMI',
            'air_temp','Air_Density','dewpoint_c',
            'ice_zone1','ice_zone2','ice_zone3','ice_zone4','ice_zone5']

# 원핫인코딩 (athlete_id)
df_enc = pd.get_dummies(df, columns=['athlete_id'], drop_first=True)
ohe_cols = [c for c in df_enc.columns if 'athlete_id_' in c]
final_features = FEATURES + ohe_cols

X = df_enc[final_features].astype(float)
y = df_enc['finish'].astype(float)
valid = X.notna().all(axis=1)
X, y = X[valid], y[valid]

print(f"학습 데이터: {len(X)}건 / {len(final_features)}개 변수")

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 2. 시계열 교차검증 + 모델 비교
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
print("\n" + "=" * 60)
print("시계열 교차검증 (TimeSeriesSplit, n_splits=5)")
print("=" * 60)

tscv = TimeSeriesSplit(n_splits=5)

models = {
    'XGBoost': xgb.XGBRegressor(
        max_depth=3, learning_rate=0.1, n_estimators=300,
        subsample=0.8, random_state=42, verbosity=0
    ),
    'Random Forest': RandomForestRegressor(
        n_estimators=300, max_depth=5, random_state=42, n_jobs=-1
    ),
    'SVR': Pipeline([
        ('scaler', StandardScaler()),
        ('svr', SVR(kernel='rbf', C=10, epsilon=0.1))
    ]),
    'MLR (선형회귀)': Pipeline([
        ('scaler', StandardScaler()),
        ('lr', LinearRegression())
    ]),
}

results = {}
fold_details = {}

for name, model in models.items():
    r2_scores, rmse_scores = [], []
    fold_info = []

    for fold, (train_idx, test_idx) in enumerate(tscv.split(X)):
        X_tr, X_te = X.iloc[train_idx], X.iloc[test_idx]
        y_tr, y_te = y.iloc[train_idx], y.iloc[test_idx]
        model.fit(X_tr, y_tr)
        y_pred = model.predict(X_te)
        r2 = r2_score(y_te, y_pred)
        rmse = np.sqrt(mean_squared_error(y_te, y_pred))
        r2_scores.append(r2)
        rmse_scores.append(rmse)
        fold_info.append({'fold': fold+1, 'train': len(X_tr), 'test': len(X_te),
                          'r2': r2, 'rmse': rmse})

    results[name] = {
        'r2_mean': np.mean(r2_scores),
        'r2_std': np.std(r2_scores),
        'rmse_mean': np.mean(rmse_scores),
        'rmse_std': np.std(rmse_scores),
        'r2_scores': r2_scores,
    }
    fold_details[name] = fold_info

    print(f"\n[{name}]")
    for f in fold_info:
        print(f"  Fold {f['fold']} | train={f['train']:4d} test={f['test']:3d} | "
              f"R²={f['r2']*100:6.2f}%  RMSE={f['rmse']:.4f}s")
    print(f"  → 평균 R²={results[name]['r2_mean']*100:.2f}% ± {results[name]['r2_std']*100:.2f}%  "
          f"RMSE={results[name]['rmse_mean']:.4f}s ± {results[name]['rmse_std']:.4f}s")

# ── 비교 테이블 출력 ────────────────────────────────
print("\n" + "=" * 60)
print("모델 성능 비교 테이블 (시계열 교차검증 기준)")
print("=" * 60)
print(f"{'모델':<20} {'R² 평균':>10} {'R² std':>8} {'RMSE 평균':>10} {'RMSE std':>8} {'순위':>4}")
print("-" * 65)
ranked = sorted(results.items(), key=lambda x: x[1]['r2_mean'], reverse=True)
for rank, (mname, r) in enumerate(ranked, 1):
    print(f"{mname:<20} {r['r2_mean']*100:>9.2f}% {r['r2_std']*100:>7.2f}% "
          f"{r['rmse_mean']:>9.4f}s {r['rmse_std']:>7.4f}s {rank:>4}")

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 3. SHAP 분석 (전체 데이터로 최종 모델 학습)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
print("\n" + "=" * 60)
print("SHAP 변수 중요도 분석")
print("=" * 60)

final_model = xgb.XGBRegressor(
    max_depth=3, learning_rate=0.1, n_estimators=300,
    subsample=0.8, random_state=42, verbosity=0
)
final_model.fit(X, y)

explainer = shap.TreeExplainer(final_model)
shap_values = explainer.shap_values(X)

# 변수 중요도 (핵심 8개 변수만 한글 라벨로)
label_map = {
    'start_time':   '스타트 시간 (초)',
    'height_cm':    '신장 (cm)',
    'weight_kg':    '체중 (kg)',
    'BMI':          'BMI',
    'air_temp':     '기온 (°C)',
    'Air_Density':  '공기밀도 (kg/m³)',
    'dewpoint_c':   '이슬점 (°C)',
    'ice_zone1':    '빙면온도 Z1 (Start→Int.1)',
    'ice_zone2':    '빙면온도 Z2 (Int.1→Int.2)',
    'ice_zone3':    '빙면온도 Z3 (Int.2→Int.3)',
    'ice_zone4':    '빙면온도 Z4 (Int.3→Int.4)',
    'ice_zone5':    '빙면온도 Z5 (Int.4→Finish)',
    'temp_avg':     '얼음온도 평균 (°C)',
}

# SHAP 절대값 평균 (mean |SHAP|)
shap_df = pd.DataFrame(shap_values, columns=X.columns)
mean_abs_shap = shap_df.abs().mean().sort_values(ascending=False)

# 핵심 8개 변수만 추출
core_shap = mean_abs_shap[mean_abs_shap.index.isin(FEATURES)].sort_values(ascending=False)
print("\n[핵심 변수별 평균 |SHAP| 값]")
for feat, val in core_shap.items():
    label = label_map.get(feat, feat)
    bar = '█' * int(val / core_shap.max() * 30)
    print(f"  {label:<22} {val:.4f}  {bar}")

# ── Figure 1: 핵심 변수 SHAP 중요도 막대그래프 ────────
fig1, ax1 = plt.subplots(figsize=(9, 5))
colors = ['#d62728' if f == 'start_time' else
          '#1f77b4' if f in ['air_temp','Air_Density','dewpoint_c','temp_avg',
                             'ice_zone1','ice_zone2','ice_zone3','ice_zone4','ice_zone5'] else
          '#2ca02c'
          for f in core_shap.index]
bars = ax1.barh(
    [label_map.get(f, f) for f in core_shap.index[::-1]],
    core_shap.values[::-1],
    color=colors[::-1], edgecolor='white', height=0.6
)
for bar, val in zip(bars, core_shap.values[::-1]):
    ax1.text(val + 0.001, bar.get_y() + bar.get_height()/2,
             f'{val:.4f}', va='center', fontsize=9)
ax1.set_xlabel('평균 |SHAP| 값 (기록 영향도)', fontsize=11)
ax1.set_title('스켈레톤 주행기록 예측 변수 중요도\n(SHAP 기반, XGBoost)', fontsize=13, fontweight='bold')
ax1.axvline(0, color='black', linewidth=0.8)

from matplotlib.patches import Patch
legend_elements = [
    Patch(facecolor='#d62728', label='스타트 변수'),
    Patch(facecolor='#1f77b4', label='환경 변수'),
    Patch(facecolor='#2ca02c', label='신체 변수'),
]
ax1.legend(handles=legend_elements, loc='lower right', fontsize=9)
plt.tight_layout()
fig1.savefig('shap_importance.png', dpi=200, bbox_inches='tight')
print("\nshap_importance.png 저장 완료")

# ── Figure 2: SHAP Beeswarm (전체 분포) ────────────────
fig2, ax2 = plt.subplots(figsize=(10, 6))
# 핵심 8개 변수만 beeswarm
core_idx = [list(X.columns).index(f) for f in FEATURES if f in X.columns]
shap.summary_plot(
    shap_values[:, core_idx],
    X[FEATURES],
    feature_names=[label_map.get(f, f) for f in FEATURES],
    show=False,
    plot_size=None,
    max_display=8,
)
plt.title('SHAP Beeswarm Plot - 변수별 기록 영향 분포\n(빨강=높은 변수값, 파랑=낮은 변수값)', fontsize=12)
plt.tight_layout()
fig2.savefig('shap_beeswarm.png', dpi=200, bbox_inches='tight')
print("shap_beeswarm.png 저장 완료")

# ── Figure 3: 모델 비교 R² 막대그래프 ─────────────────
fig3, ax3 = plt.subplots(figsize=(8, 5))
model_names = [n for n, _ in ranked]
r2_means = [r['r2_mean'] * 100 for _, r in ranked]
r2_stds  = [r['r2_std'] * 100 for _, r in ranked]
bar_colors = ['#d62728' if n == 'XGBoost' else '#aec7e8' for n in model_names]

bars3 = ax3.bar(model_names, r2_means, yerr=r2_stds,
                color=bar_colors, edgecolor='white',
                capsize=6, error_kw={'linewidth': 1.5})
for bar, val, std in zip(bars3, r2_means, r2_stds):
    ax3.text(bar.get_x() + bar.get_width()/2, val + std + 0.5,
             f'{val:.1f}%', ha='center', fontsize=10, fontweight='bold')

ax3.set_ylim(0, 100)
ax3.set_ylabel('R² (%)', fontsize=12)
ax3.set_title('스켈레톤 주행기록 예측 모델 성능 비교\n(시계열 교차검증 5-Fold 평균 ± 표준편차)', fontsize=12, fontweight='bold')
ax3.axhline(85, color='gray', linestyle='--', linewidth=1, alpha=0.7)
ax3.text(3.4, 85.5, 'R²=85% 기준선', fontsize=8, color='gray')
plt.tight_layout()
fig3.savefig('model_comparison.png', dpi=200, bbox_inches='tight')
print("model_comparison.png 저장 완료")

# ── Figure 4: SHAP 의존성 플롯 (start_time, temp_avg) ──
fig4, axes = plt.subplots(1, 2, figsize=(12, 5))

for ax, feat, color in zip(axes, ['start_time', 'ice_zone4'], ['#d62728', '#1f77b4']):
    feat_idx = list(X.columns).index(feat)
    shap_col = shap_values[:, feat_idx]
    ax.scatter(X[feat], shap_col, alpha=0.4, s=15, color=color)
    # 추세선
    z = np.polyfit(X[feat].values, shap_col, 1)
    p = np.poly1d(z)
    xline = np.linspace(X[feat].min(), X[feat].max(), 100)
    ax.plot(xline, p(xline), 'k--', linewidth=1.5, alpha=0.7)
    ax.axhline(0, color='black', linewidth=0.8, alpha=0.5)
    ax.set_xlabel(label_map.get(feat, feat), fontsize=11)
    ax.set_ylabel('SHAP 값 (기록에 미치는 영향, 초)', fontsize=10)
    ax.set_title(f'{label_map.get(feat, feat)} vs SHAP', fontsize=11, fontweight='bold')

plt.suptitle('주요 변수 의존성 분석 (SHAP Dependence Plot)', fontsize=12, fontweight='bold')
plt.tight_layout()
fig4.savefig('shap_dependence.png', dpi=200, bbox_inches='tight')
print("shap_dependence.png 저장 완료")

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 4. 2-Tier 비교 분석 (논문 핵심 구조)
#    Tier 1: 환경+신체 변수만 (선수 식별자 없이)
#    Tier 2: 환경+신체+선수(athlete_id)
#    Gap = 선수 개인 특성의 기여도
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
print("\n" + "=" * 60)
print("2-Tier 비교 분석: 환경 변수 vs 환경+선수")
print("=" * 60)

# --- 변수 그룹 정의 ---
#   점진적으로 변수를 추가하여 각 그룹의 한계 기여도를 측정
ENV_ONLY = ['air_temp', 'Air_Density', 'dewpoint_c', 'ice_zone1', 'ice_zone2', 'ice_zone3', 'ice_zone4', 'ice_zone5']
PHYSICAL = ['height_cm', 'weight_kg', 'BMI']
START    = ['start_time']

tier_configs = {
    'Tier 1\n스타트만':            START,
    'Tier 2\n스타트+환경':         START + ENV_ONLY,
    'Tier 3\n스타트+환경+신체':    START + ENV_ONLY + PHYSICAL,
    'Tier 4\n전체(+선수ID)':       'FULL',   # FEATURES + athlete_id OHE
}

tier_results = {}
tscv5 = TimeSeriesSplit(n_splits=5)

for tier_name, feat_set in tier_configs.items():
    if feat_set == 'FULL':
        X_tier = X.copy()
    else:
        X_tier = df_enc[feat_set].astype(float)
        valid_t = X_tier.notna().all(axis=1) & y.index.isin(X_tier.index)
        X_tier = X_tier.loc[valid_t]

    y_tier = y.loc[X_tier.index]

    model_t = xgb.XGBRegressor(
        max_depth=3, learning_rate=0.1, n_estimators=300,
        subsample=0.8, random_state=42, verbosity=0
    )

    r2_list, rmse_list = [], []
    for train_idx, test_idx in tscv5.split(X_tier):
        X_tr, X_te = X_tier.iloc[train_idx], X_tier.iloc[test_idx]
        y_tr, y_te = y_tier.iloc[train_idx], y_tier.iloc[test_idx]
        model_t.fit(X_tr, y_tr)
        y_pred = model_t.predict(X_te)
        r2_list.append(r2_score(y_te, y_pred))
        rmse_list.append(np.sqrt(mean_squared_error(y_te, y_pred)))

    tier_results[tier_name] = {
        'r2_mean': np.mean(r2_list), 'r2_std': np.std(r2_list),
        'rmse_mean': np.mean(rmse_list), 'rmse_std': np.std(rmse_list),
        'n_features': X_tier.shape[1],
    }
    tr = tier_results[tier_name]
    short = tier_name.replace('\n', ' / ')
    print(f"  {short:<30} | 변수 {tr['n_features']:>2}개 | "
          f"R²={tr['r2_mean']*100:5.1f}% ± {tr['r2_std']*100:4.1f}% | "
          f"RMSE={tr['rmse_mean']:.4f}s")

# Gap 계산 (각 Tier 간 증분)
t1_r2 = tier_results['Tier 1\n스타트만']['r2_mean']
t2_r2 = tier_results['Tier 2\n스타트+환경']['r2_mean']
t3_r2 = tier_results['Tier 3\n스타트+환경+신체']['r2_mean']
t4_r2 = tier_results['Tier 4\n전체(+선수ID)']['r2_mean']
print(f"\n  ★ Tier 1 스타트만:         R² {t1_r2*100:.1f}%")
print(f"  ★ Tier 2 +환경변수 추가:   R² {t2_r2*100:.1f}% (환경 기여: +{(t2_r2-t1_r2)*100:.1f}%p)")
print(f"  ★ Tier 3 +신체변수 추가:   R² {t3_r2*100:.1f}% (신체 기여: +{(t3_r2-t2_r2)*100:.1f}%p)")
print(f"  ★ Tier 4 +선수ID 추가:    R² {t4_r2*100:.1f}% (선수ID 기여: +{(t4_r2-t3_r2)*100:.1f}%p)")

# ── Figure 5: Tier 비교 누적 막대그래프 ─────────────────
fig5, ax5 = plt.subplots(figsize=(9, 5.5))
tier_names = list(tier_results.keys())
tier_r2 = [tier_results[t]['r2_mean'] * 100 for t in tier_names]
tier_std = [tier_results[t]['r2_std'] * 100 for t in tier_names]
tier_colors = ['#4292c6', '#2171b5', '#08519c', '#d62728']

bars5 = ax5.bar(tier_names, tier_r2, yerr=tier_std,
                color=tier_colors, edgecolor='white', width=0.55,
                capsize=5, error_kw={'linewidth': 1.2})
for bar, val, std in zip(bars5, tier_r2, tier_std):
    ax5.text(bar.get_x() + bar.get_width()/2, val + std + 0.8,
             f'{val:.1f}%', ha='center', fontsize=10, fontweight='bold')

# 증분 표시 화살표 (Tier 1 → Tier 2)
for i in range(len(tier_r2) - 1):
    if tier_r2[i+1] > tier_r2[i]:
        delta = tier_r2[i+1] - tier_r2[i]
        mid = (tier_r2[i] + tier_r2[i+1]) / 2
        ax5.annotate(f'+{delta:.1f}%p', xy=(i+0.5, mid),
                     fontsize=8, ha='center', va='center', color='#333333',
                     bbox=dict(boxstyle='round,pad=0.2', facecolor='#ffffcc', alpha=0.8))

ax5.set_ylim(0, max(tier_r2) + 15)
ax5.set_ylabel('R² (%)', fontsize=12)
ax5.set_title('변수 그룹별 예측 성능 비교\n(시계열 교차검증 5-Fold, XGBoost)', fontsize=13, fontweight='bold')
plt.tight_layout()
fig5.savefig('tier_comparison.png', dpi=200, bbox_inches='tight')
print("\ntier_comparison.png 저장 완료")

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 5. 변수 제거 실험 (Ablation Study)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
print("\n" + "=" * 60)
print("변수 제거 실험 (Ablation Study)")
print("=" * 60)

ablation = {}
baseline_feats = FEATURES.copy()
# 전체 기준선 (athlete_id 없이, 순수 8개 변수)
X_base = df_enc[baseline_feats].astype(float)
y_base = y.loc[X_base.index]
valid_b = X_base.notna().all(axis=1)
X_base, y_base = X_base[valid_b], y_base[valid_b]

def cv_r2(X_in, y_in):
    r2s = []
    for tr_i, te_i in tscv5.split(X_in):
        m = xgb.XGBRegressor(max_depth=3, learning_rate=0.1, n_estimators=300,
                              subsample=0.8, random_state=42, verbosity=0)
        m.fit(X_in.iloc[tr_i], y_in.iloc[tr_i])
        r2s.append(r2_score(y_in.iloc[te_i], m.predict(X_in.iloc[te_i])))
    return np.mean(r2s)

base_r2 = cv_r2(X_base, y_base)
print(f"  기준선 (8개 변수 전체): R²={base_r2*100:.2f}%\n")

for feat in FEATURES:
    reduced = [f for f in FEATURES if f != feat]
    X_red = df_enc[reduced].astype(float)
    y_red = y.loc[X_red.index]
    vr = X_red.notna().all(axis=1)
    X_red, y_red = X_red[vr], y_red[vr]
    abl_r2 = cv_r2(X_red, y_red)
    drop = (base_r2 - abl_r2) * 100
    ablation[feat] = {'r2': abl_r2, 'drop': drop}
    direction = '▼' if drop > 0 else '▲'
    label = label_map.get(feat, feat)
    print(f"  - {feat:<15} 제거 시 R²={abl_r2*100:.2f}%  ({direction}{abs(drop):.2f}%p)")

# ── Figure 6: Ablation 그래프 ────────────────────────
fig6, ax6 = plt.subplots(figsize=(9, 5))
sorted_abl = sorted(ablation.items(), key=lambda x: x[1]['drop'], reverse=True)
abl_feats = [label_map.get(f, f) for f, _ in sorted_abl]
abl_drops = [v['drop'] for _, v in sorted_abl]
abl_colors = ['#d62728' if d > 0.5 else '#ff7f0e' if d > 0 else '#2ca02c' for d in abl_drops]

bars6 = ax6.barh(abl_feats[::-1], abl_drops[::-1], color=abl_colors[::-1],
                 edgecolor='white', height=0.55)
for bar, val in zip(bars6, abl_drops[::-1]):
    xpos = val + 0.05 if val >= 0 else val - 0.05
    ha = 'left' if val >= 0 else 'right'
    ax6.text(xpos, bar.get_y() + bar.get_height()/2,
             f'{val:+.2f}%p', va='center', ha=ha, fontsize=9)

ax6.axvline(0, color='black', linewidth=0.8)
ax6.set_xlabel('R² 변화량 (%p) — 해당 변수 제거 시 성능 하락', fontsize=10)
ax6.set_title('변수 제거 실험 (Ablation Study)\n양수 = 제거 시 성능 하락, 음수 = 제거해도 무방',
              fontsize=12, fontweight='bold')
plt.tight_layout()
fig6.savefig('ablation_study.png', dpi=200, bbox_inches='tight')
print("\nablation_study.png 저장 완료")

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 6. 최종 요약
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
print("\n" + "=" * 60)
print("최종 분석 요약 (논문용)")
print("=" * 60)
best_name, best = ranked[0]
print(f"\n[시계열 교차검증 최우수 모델] {best_name}")
print(f"  R²: {best['r2_mean']*100:.2f}% ± {best['r2_std']*100:.2f}%")
print(f"  RMSE: {best['rmse_mean']:.4f}초 ± {best['rmse_std']:.4f}초")

print(f"\n[Tier 분석 결과 - 변수 그룹별 한계 기여도]")
print(f"  스타트만:         R² {t1_r2*100:.1f}%")
print(f"  +환경변수:        R² {t2_r2*100:.1f}% (환경 기여: +{(t2_r2-t1_r2)*100:.1f}%p)")
print(f"  +신체변수:        R² {t3_r2*100:.1f}% (신체 기여: +{(t3_r2-t2_r2)*100:.1f}%p)")
print(f"  +선수ID:         R² {t4_r2*100:.1f}% (선수ID 기여: +{(t4_r2-t3_r2)*100:.1f}%p)")

print("\n[SHAP 변수 중요도 TOP 3]")
for i, (feat, val) in enumerate(core_shap.head(3).items(), 1):
    print(f"  {i}위. {label_map.get(feat, feat)}: {val:.4f}")

print(f"\n[Ablation 핵심 발견]")
top_abl = sorted(ablation.items(), key=lambda x: x[1]['drop'], reverse=True)[:3]
for feat, v in top_abl:
    print(f"  {label_map.get(feat, feat)}: 제거 시 R² {v['drop']:+.2f}%p 변화")

print("\n생성된 파일:")
for f in ['shap_importance.png', 'shap_beeswarm.png',
          'model_comparison.png', 'shap_dependence.png',
          'tier_comparison.png', 'ablation_study.png']:
    print(f"  {f}")
