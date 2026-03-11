# 대시보드 디자인 분석

참조 이미지: `KakaoTalk_20260311_105716516.png`

---

## 전체 레이아웃

- **3단 구성**: 좌(입력) | 중앙(트랙 시각화) | 우(AI 예측+코칭)
- 다크 테마 (#0f1923 계열)
- 상단 타이틀: "봅슬레이 주행 예측 및 코칭 전략 대시보드 (심사위원 발표용)"
- 하단 범례: "알고리즘: XGBoost, MLR | 연구팀 | 연구팀 이름 (심사위원용)"

---

## 좌측: 1. 입력 데이터 (Input Data)

### 선수 프로필 및 목표
- Athlete ID: BSB-KOR-03 (가명)
- 키(Height): 181 cm
- 몸무게(Weight): 86 kg
- 목표 스타트 기록(Target Start Time): `[4.85s]` (입력 필드)

### 실시간 환경 데이터 (Live Weather API) (Pyeongchang)
- -7.2°C | 65% | 1018 hPa
- 아이콘: 온도계, 습도, 기압

### 기상 계산치 (Calculated)
- 공기밀도(Air Density): 1.28 kg/m³
- 이슬점 온도(Dew Point): -12.4°C

### 현장 얼음 온도 (Ice Temp)
- 수동 입력(Manual Device) ❄
- 6개월 평균(6 Month Avg): -5.1°C

### 이상치 데이터 필터링 (Filtering Status)
- **활성 (Active)** 녹색 뱃지
- Phase 2 Skidding Detected (Turn 8 Entry)
- *이상치 데이터 제거 활성화 (Outlier Filtered)** → 훈련 데이터 필터 적용

---

## 중앙: 2. 주행 데이터 시각화 및 필터링 (Data Visualization)

### 평창 슬라이딩 센터 개요 (Pyeongchang Track)
- 트랙 전체 조감도 (S자 형태)
- Turn 1 ~ Turn 15 라벨 표시
- **속도 히트맵**: 커브별 색상 그라데이션
  - 60~80 km/h: 파랑
  - 80~100: 청록
  - 100~110: 녹색
  - 110~120: 노랑~주황
  - 120~130: 빨강
- Speed (km/h) 범례 바

---

## 우측: 3. AI 예측 결과 및 코칭 전략 (AI Prediction & Coaching)

### 최종 예상 기록 (Predicted Finish Time)
- **52.34s** (대형 숫자, 시안 계열 글로우 효과)
- 모델: XGBoost (감성뭔), 정확도: 96.8%

### Run Distribution & Prediction
- 소형 히스토그램/분포 차트 (52.34s 위치에 화살표)

### 데이터 기반 코칭 Tip (Coaching Insight)
- 코칭 Tip: 현재 환경에서 최적 스타트 포스는...
- 0.03s 이슬점으로 인한 마찰 보정이 필요합니다.
- Optimization Goal: Turn 13 Entry Velocity
- MLR Analysis: Start Time Impact (-2.49)

---

## 디자인 요소

| 항목 | 값 |
|------|-----|
| 배경 | 다크 (#0f1923 계열) |
| 강조색 | 시안 (#00e5ff), 녹색 뱃지, 주황 경고 |
| 카드 | 반투명 다크 패널, 라운드 코너 |
| 폰트 | 산세리프, 굵은 수치 강조 |
| 분위기 | 게이밍/우주 대시보드 느낌 |
