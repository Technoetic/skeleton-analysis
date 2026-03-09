# 예측 모델 알고리즘 상세 문서

> 소스: `web/src/js/PredictionModel.js` (1,121줄)
> 최종 갱신: 2026-03-09

---

## 목차

1. [개요](#1-개요)
2. [모델 1: 단순 선형 회귀 (Simple Linear Regression)](#2-모델-1-단순-선형-회귀)
3. [모델 2: 다중 선형 회귀 (Multiple Linear Regression)](#3-모델-2-다중-선형-회귀)
4. [모델 3: 구간별 가중 예측 (Segment Prediction)](#4-모델-3-구간별-가중-예측)
5. [모델 4: 2차 다항 회귀 (Polynomial Regression)](#5-모델-4-2차-다항-회귀)
6. [모델 5: 앙상블 예측 (Ensemble)](#6-모델-5-앙상블-예측)
7. [교차 검증 (K-Fold Cross Validation)](#7-교차-검증)
8. [부트스트랩 신뢰구간 (Bootstrap CI)](#8-부트스트랩-신뢰구간)
9. [범용 다중선형회귀 (General MLR)](#9-범용-다중선형회귀)
10. [공통 내부 알고리즘](#10-공통-내부-알고리즘)
11. [모델 비교 요약](#11-모델-비교-요약)

---

## 1. 개요

평창 알펜시아 슬라이딩센터(1,200m, 커브 16개)의 스켈레톤 경기 데이터를 학습하여 Finish Time을 예측하는 클라이언트 사이드 JavaScript 모델.

### 데이터 구조

| 컬럼 | 설명 | 단위 |
|------|------|------|
| `start_time` | 출발 후 첫 계측 (20~50m) | 초 |
| `int1` | 4번 커브 입구 (누적) | 초 |
| `int2` | 7번 커브 입구 (누적) | 초 |
| `int3` | 12번 커브 입구 (누적) | 초 |
| `int4` | 15번 커브 입구 (누적) | 초 |
| `finish` | 피니시 (누적) | 초 |

### 핵심 도메인 지식

- **Start Time 0.1초 단축 → Finish 약 0.3초 단축** (3배 증폭 효과)
- 정상 출발: Start ~4.7~5.5초, Finish ~50~55초
- 성별로 데이터를 분리하여 학습 (남/여 별도 모델)

---

## 2. 모델 1: 단순 선형 회귀

### 수식

```
Finish = a × StartTime + b
```

### 알고리즘: 가중 최소제곱법 (WLS)

일반 OLS가 아닌 **시계열 가중 최소제곱법**을 사용한다.

#### 가중치 계산

최근 데이터에 높은 가중치를 부여하는 지수 감쇠:

```
w_i = exp(-λ × (t_max - t_i) / (30 × 86400000))
```

- `λ = 0.05` (감쇠 속도)
- `t_max`: 가장 최근 날짜의 타임스탬프
- `t_i`: 해당 레코드의 날짜
- 30일 단위로 정규화

#### 가중 회귀 계수

```
mx = Σ(w_i × x_i) / Σw_i
my = Σ(w_i × y_i) / Σw_i
a  = Σ(w_i × (x_i - mx)(y_i - my)) / Σ(w_i × (x_i - mx)²)
b  = my - a × mx
```

#### R² 계산

```
R² = [Σ(w_i × (x_i - mx)(y_i - my))]² / [Σ(w_i × (x_i - mx)²) × Σ(w_i × (y_i - my)²)]
```

#### Leverage 기반 신뢰구간

개별 예측점의 신뢰구간을 **Leverage (hat value)** 로 조정:

```
h = x' (X'WX)⁻¹ x    (x = [1, startTime])
SE = σ_residual × √(1 + h)
CI = [predicted - SE, predicted + SE]
```

- `h`가 크면 (학습 데이터 범위 밖): 넓은 신뢰구간
- `h`가 작으면 (데이터 중심 근처): 좁은 신뢰구간

#### 신뢰 기준

- R² > 0.3 **AND** n ≥ 5 → 신뢰 가능

---

## 3. 모델 2: 다중 선형 회귀

### 수식

```
Finish = β₀ + β₁×Start + β₂×Seg1 + β₃×Seg2 + β₄×Seg3 + β₅×Seg4
         + β₆×TempAvg + β₇×(Start×Seg1) + offset_player
```

### 피처 엔지니어링

| 피처 | 계산 방식 | 의미 |
|------|----------|------|
| `start_time` | 원본 값 | 출발 구간 |
| `seg1` | `int1 - start_time` | Start → Int.1 구간 시간 |
| `seg2` | `int2 - int1` | Int.1 → Int.2 구간 시간 |
| `seg3` | `int3 - int2` | Int.2 → Int.3 구간 시간 |
| `seg4` | `int4 - int3` | Int.3 → Int.4 구간 시간 |
| `temp_avg` | DB값 또는 기본값 -7 | 트랙 평균 온도 (°C) |
| `start×seg1` | `start_time × seg1` | **상호작용항**: 출발과 초기 주행의 결합 효과 |

### 전처리

#### 1단계: 이상치 제거

예비 회귀를 수행한 뒤 잔차 기반으로 이상치 제거:

```
1. 전체 데이터로 OLS 회귀
2. 각 레코드의 잔차(residual) 계산
3. 잔차의 Z-score 계산
4. |Z| > 2.5인 레코드 제거
```

#### 2단계: Z-score 정규화

모든 피처를 Z-score로 표준화:

```
x_normalized = (x - mean) / std
```

- 스케일이 다른 피처 간의 비교를 가능하게 함
- Ridge 정규화의 효과를 균등하게 적용

#### 3단계: 시계열 가중치

단순 선형 회귀와 동일한 지수 감쇠 가중치 적용.

### Ridge 정규화

데이터/피처 비율에 따라 λ를 자동 선택:

| 데이터/피처 비율 | Ridge λ | 정규화 강도 |
|:---:|:---:|:---:|
| < 5 | 1.0 | 강함 (과적합 방지) |
| 5 ~ 10 | 0.1 | 중간 |
| > 10 | 0.01 | 약함 (충분한 데이터) |

정규방정식에 Ridge 적용:

```
(X'WX + λI)β = X'Wy    (절편 제외하고 대각선에 λ 추가)
```

### 선수 개인 보정 (Player Offset)

모델 학습 후 선수별 잔차 평균을 계산하여 개인 보정값으로 사용:

```
offset_player = mean(y_actual - y_predicted)    (해당 선수의 학습 데이터에서)
```

- 2개 이상의 레코드가 있는 선수만 보정 적용
- 선수 고유의 주행 특성(라인 선택, 자세 등)을 반영

### 진단 통계

| 지표 | 수식 | 용도 |
|------|------|------|
| **Durbin-Watson** | `Σ(e_i - e_{i-1})² / Σe_i²` | 잔차 자기상관 검정 (2에 가까울수록 양호) |
| **VIF** | `1 / (1 - R²_j)` | 다중공선성 검정 (10 이상이면 문제) |
| **Leverage** | `h = x'(X'WX)⁻¹x` | 영향력 있는 관측치 식별 |

#### VIF 계산 방법

각 피처 j에 대해:
1. 피처 j를 종속변수, 나머지 피처를 독립변수로 보조 회귀
2. 보조 회귀의 R²로 VIF 계산: `VIF_j = 1 / (1 - R²_j)`

#### 신뢰 기준

- R² > 0.5 **AND** n ≥ 5 → 신뢰 가능

---

## 4. 모델 3: 구간별 가중 예측

### 개념

중간 계측점(Int.1~4)의 **실측값**을 기준으로 나머지 구간 시간을 예측.

```
Finish = Int.N + 잔여구간_예측값
```

### 4개의 하위 모델

| 모델 | 입력 | 예측 대상 |
|------|------|----------|
| `fromInt4` | Int.4 실측 | Finish (약 7~8초 잔여) |
| `fromInt3` | Int.3 실측 | Finish (약 18~20초 잔여) |
| `fromInt2` | Int.2 실측 | Finish (약 28~30초 잔여) |
| `fromInt1` | Int.1 실측 | Finish (약 37~40초 잔여) |

### 예측 방식 선택

각 하위 모델에 대해 단순 선형 회귀를 수행하고, 모델 품질에 따라 방식 결정:

```
IF R² ≥ 0.5 AND n ≥ 5:
    predicted = a × IntN + b              (회귀 예측)
    CI = predicted ± residualStd
ELSE:
    predicted = IntN + 잔여구간_평균       (단순 평균 예측)
    CI = predicted ± 잔여구간_표준편차
```

### 특징

- Int.4 기반이 가장 정확 (잔여 구간이 짧으므로)
- Int.1 기반은 정확도 낮지만 빠른 시점에 예측 가능
- 경기 중 실시간 예측에 적합

---

## 5. 모델 4: 2차 다항 회귀

### 수식

```
Finish = β₀ + β₁×StartTime + β₂×StartTime²
```

### 알고리즘

단순 선형 회귀의 비선형 확장. Start Time과 그 제곱을 독립변수로 사용.

- `X = [StartTime, StartTime²]` 로 변환 후 가중 다중선형회귀 적용
- 시계열 가중치(WLS) 동일 적용
- Leverage 기반 신뢰구간 동일 적용

### 왜 2차인가

- Start Time과 Finish의 관계가 완전한 직선이 아닐 수 있음
- 극단적으로 빠르거나 느린 출발에서 비선형 효과 가능
- 3차 이상은 데이터 규모(수백 건)에서 과적합 위험

#### 신뢰 기준

- R² > 0.3 **AND** n ≥ 5 → 신뢰 가능

---

## 6. 모델 5: 앙상블 예측

### 개념

교차 검증(CV) R²를 가중치로 사용하여 여러 모델의 예측을 결합.

### 가중 평균

```
w_i = max(0, CV_R²_i)
W = Σw_i

predicted = Σ(w_i / W × pred_i)
```

### 참여 모델 및 조건

| 모델 | 참여 조건 | 가중치 출처 |
|------|----------|------------|
| Simple | n ≥ 3 | CV R² (simple) |
| Poly | n ≥ 5 | CV R² (poly) |
| Multi | multiFeatures 입력 있음 | CV R² (multi) |

### 불확실성 추정

앙상블의 신뢰구간은 모델 간 **가중 분산**으로 계산:

```
variance = Σ(w_i × (pred_i - pred_ensemble)²)
SE = max(√variance, σ_residual_simple)

CI = [predicted - SE, predicted + SE]
```

### 폴백

모든 모델의 CV R²가 0이면 균등 가중 평균으로 폴백.

---

## 7. 교차 검증

### K-Fold CV (k=5)

#### 절차

```
1. 데이터를 Fisher-Yates 셔플
2. k개 폴드로 분할
3. 각 폴드에서:
   - 나머지 k-1개 폴드로 학습
   - 해당 폴드로 테스트
   - MAE, RMSE, R² 계산
4. k개 폴드의 평균 메트릭 산출
```

#### 검증 대상 모델

| 모델 | 학습 방식 | 비고 |
|------|----------|------|
| Simple | OLS | 정규화 없음 |
| Multi | Z-score + Ridge | 폴드별 독립 정규화 |
| Poly | OLS + `[x, x²]` | - |

#### 폴드별 정규화

다중 회귀의 경우 **각 폴드의 학습 데이터에서 독립적으로** mean/std를 계산하여 정규화. 테스트 데이터에는 학습 데이터의 mean/std를 적용 (data leakage 방지).

#### 메트릭

| 메트릭 | 수식 | 해석 |
|--------|------|------|
| **MAE** | `Σ\|e_i\| / n` | 평균 절대 오차 (초) |
| **RMSE** | `√(Σe_i² / n)` | 큰 오차에 민감 |
| **R²** | `1 - SS_res / SS_tot` | 설명력 (1에 가까울수록 좋음) |

#### 최소 데이터 요건

- `n ≥ k × 2 = 10` 이상이어야 CV 수행

---

## 8. 부트스트랩 신뢰구간

### 알고리즘

```
FOR b = 1 to B (기본 B=200):
    1. 원본 데이터에서 n개를 복원 추출 (bootstrap sample)
    2. 해당 샘플로 모델 학습
    3. 입력값에 대한 예측 수행
    4. 예측값 저장

95% CI = [예측값의 2.5% 분위수, 97.5% 분위수]
```

### 적용 모델

- `simple`: 단순 선형 회귀
- `poly`: 2차 다항 회귀
- `multi`: 다중 선형 회귀

### 안전장치

- 200회 중 50% 이상 학습 실패 시 → CI 결과 반환하지 않음
- 각 bootstrap 반복에서 모델이 신뢰 기준을 통과해야만 예측값 수집

---

## 9. 범용 다중선형회귀

### 목적

사용자가 키/몸무게/환경 조건을 입력하여 예측하는 확장 모델.

### 현재 피처

```
Finish = β₀ + β₁×StartTime + β₂×IceTemp
```

> DB에 키/몸무게 데이터가 없어 현재는 start_time + ice_temp만 사용.

### 전처리

1. 유효 레코드 필터링 (`status=OK`, `finish < 70`)
2. IQR 기반 이상치 제거 (`Q1 - 2.5×IQR ~ Q3 + 2.5×IQR`)
3. 최소 n ≥ 10 필요

### 출력 통계

일반 모델과 달리 상세 진단 정보를 포함:

| 출력 | 설명 |
|------|------|
| 기술 통계량 | 각 피처의 mean, std, min, max |
| 상관관계 행렬 | Pearson 상관계수 (피처 간, 피처-종속변수) |
| 회귀 계수 상세 | B (비표준화), β (표준화), t-value, p-value, VIF |
| Durbin-Watson | 잔차 자기상관 검정 |
| 실제 vs 예측 | 차트용 산점도 데이터 |

### p-value 근사

t-분포의 p-value를 자체 구현:

- df > 30: 정규 근사 (erf 함수 사용)
- df ≤ 30: 정칙 불완전 베타 함수의 급수 전개

감마 함수는 Lanczos 근사 (g=7, 9항) 사용.

---

## 10. 공통 내부 알고리즘

### 정규방정식 풀이

가우스 소거법 (부분 피벗):

```
1. 확대 행렬 [A|b] 구성
2. 각 열에 대해:
   a. 최대 절대값 행을 피벗으로 선택 (수치 안정성)
   b. 피벗 행 정규화 (피벗 = 1)
   c. 다른 행에서 피벗 열 소거
3. 마지막 열이 해벡터
```

### 역행렬 (Gauss-Jordan)

Leverage 계산을 위한 (X'WX)⁻¹:

```
1. 확대 행렬 [A|I] 구성
2. 가우스-조르단 소거 수행
3. 우측 절반이 A⁻¹
```

### 2×2 역행렬 (단순 회귀 전용)

단순 선형 회귀의 X'WX는 2×2이므로 공식 해:

```
[s11/det   -s01/det]     s00 = Σw_i
[-s01/det   s00/det]     s01 = Σw_i×x_i
                          s11 = Σw_i×x_i²
det = s00×s11 - s01²
```

### 시계열 가중치 (모든 WLS 모델 공통)

```
w_i = exp(-0.05 × days_ago / 30)
```

| 경과 시간 | 가중치 |
|----------|:------:|
| 당일 | 1.000 |
| 30일 전 | 0.951 |
| 90일 전 | 0.861 |
| 180일 전 | 0.741 |

---

## 11. 모델 비교 요약

| 모델 | 입력 | 피처 수 | 정규화 | 가중치 | 주 용도 |
|------|------|:-------:|:------:|:------:|---------|
| **Simple** | Start Time | 1 | - | WLS | 빠른 예측, 베이스라인 |
| **Poly** | Start Time | 2 | - | WLS | 비선형 관계 포착 |
| **Multi** | Start + Int.1~4 + 온도 | 7 | Z-score + Ridge | WLS | 정밀 예측, 진단 |
| **Segment** | Int.N 실측값 | 1 | - | - | 경기 중 실시간 예측 |
| **Ensemble** | (위 모델 결합) | - | - | CV R² 가중 | 안정적 종합 예측 |
| **General MLR** | Start + IceTemp | 2 | IQR 이상치 | - | 환경 변인 분석용 |

### 신뢰 기준 요약

| 모델 | R² 기준 | 최소 데이터 |
|------|:-------:|:----------:|
| Simple | > 0.3 | 5 |
| Poly | > 0.3 | 5 |
| Multi | > 0.5 | 5 |
| Segment | - | 3 |
| CV | - | 10 |
| Bootstrap | - | 5 |

---

## 부록: 파일 구조

```
PredictionModel.js
├── constructor()                    # 상태 초기화
├── train() / predict()              # 모델 1: 단순 선형 회귀
├── trainMulti() / predictMulti()    # 모델 2: 다중 선형 회귀
├── trainSegment() / predictFromSegment()  # 모델 3: 구간별 예측
├── trainPoly() / predictPoly()      # 모델 4: 2차 다항 회귀
├── predictEnsemble()                # 모델 5: 앙상블
├── crossValidate()                  # K-Fold CV
├── bootstrapPredict()               # 부트스트랩 CI
├── trainGeneralMLR()                # 범용 MLR
├── trainAll()                       # 전체 학습 (1~4 + CV)
├── getModelComparison()             # 모델 비교 리포트
└── Private methods
    ├── #simpleLinearRegression()     # OLS
    ├── #multipleLinearRegression()   # 정규방정식
    ├── #weightedSimpleRegression()   # WLS (1변수)
    ├── #weightedMultipleLinearRegression()  # WLS + Ridge
    ├── #filterOutliers()            # Z-score 이상치 제거
    ├── #computeTimeWeights()        # 지수 감쇠 가중치
    ├── #computeLeverage()           # hat value
    ├── #solveLinearSystem()          # 가우스 소거
    ├── #invertMatrixGJ()            # Gauss-Jordan 역행렬
    ├── #invertMatrix2x2()           # 2×2 해석 해
    ├── #tDistPValue()               # t-분포 p-value
    ├── #erf()                       # 오차 함수
    ├── #beta()                      # 베타 함수
    └── #gamma()                     # 감마 함수 (Lanczos)
```
