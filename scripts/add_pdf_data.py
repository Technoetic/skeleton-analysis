import pandas as pd
import numpy as np
import sys
sys.stdout.reconfigure(encoding='utf-8')

# KMA 기상 데이터 (경기 시간대 기준)
weather = {
    '2026-03-04': {'air_temp': 3.6,  'humidity_pct': 60.9, 'pressure_hpa': 931.7, 'wind_speed_ms': 0.6,  'dewpoint_c': -3.2},
    '2026-03-11': {'air_temp': 5.8,  'humidity_pct': 21.6, 'pressure_hpa': 932.8, 'wind_speed_ms': 1.5,  'dewpoint_c': -14.5},
    '2026-03-13': {'air_temp': -2.8, 'humidity_pct': 95.4, 'pressure_hpa': 938.8, 'wind_speed_ms': 3.8,  'dewpoint_c': -3.4},
    '2026-03-17': {'air_temp': 9.1,  'humidity_pct': 26.7, 'pressure_hpa': 930.2, 'wind_speed_ms': 2.2,  'dewpoint_c': -9.1},
}

# 선수 athlete_id 매핑
athlete_ids = {
    'YEO Chanhyuk':  'ATH-81CCC6D3',
    'HONG Sujung':   'ATH-CCB3D4AE',
    'KIM Yerim':     'ATH-16B2F494',
    'KWACK Eunwoo':  'ATH-F6E5D0C9',
    'SONG Youngmin': 'ATH-15459358',
    'KIM Jisoo':     'ATH-B78B10F1',
    'JUNG Seunggi':  'ATH-56A76FCD',
    'JUNG Janghwan': 'ATH-54955BB9',
}

# PDF 추출 기록
# (date, name, nat, gender, run, start_time, int1, int2, int3, int4, finish, speed, format)
records = [
    # 2026-03-04
    ('2026-03-04','SONG Youngmin','KOR','M',1, 4.95,14.72,24.01,34.90,46.60,54.23,116.01,'NATIONAL'),
    ('2026-03-04','SONG Youngmin','KOR','M',2, 4.93,14.66,23.93,34.85,46.65,54.36,114.93,'NATIONAL'),
    ('2026-03-04','KWACK Eunwoo', 'KOR','M',1, 5.01,14.82,24.26,35.55,47.69,55.56,111.94,'NATIONAL'),
    ('2026-03-04','KWACK Eunwoo', 'KOR','M',2, 5.01,14.83,24.19,35.23,47.19,55.06,112.69,'NATIONAL'),
    ('2026-03-04','HONG Sujung',  'KOR','F',1, 5.41,15.41,24.79,35.83,47.64,55.34,115.50,'NATIONAL'),
    ('2026-03-04','HONG Sujung',  'KOR','F',2, 5.37,15.37,24.74,35.68,47.56,55.50,108.71,'NATIONAL'),
    ('2026-03-04','KIM Yerim',    'KOR','F',1, 5.62,15.74,25.16,36.15,48.42,56.57,110.07,'NATIONAL'),
    ('2026-03-04','KIM Yerim',    'KOR','F',2, 5.68,15.83,25.28,36.33,48.93,57.40,104.48,'NATIONAL'),
    # 2026-03-11
    ('2026-03-11','YEO Chanhyuk', 'KOR','M',1, 4.96,14.62,23.61,34.14,45.18,52.19,123.60,'NATIONAL'),
    ('2026-03-11','YEO Chanhyuk', 'KOR','M',2, 4.95,14.60,23.60,34.07,45.18,52.26,122.54,'NATIONAL'),
    ('2026-03-11','SONG Youngmin','KOR','M',1, 5.07,14.79,23.89,34.62,46.22,53.79,118.01,'NATIONAL'),
    ('2026-03-11','SONG Youngmin','KOR','M',2, 4.97,14.66,23.77,34.44,45.80,53.11,119.30,'NATIONAL'),
    ('2026-03-11','KWACK Eunwoo', 'KOR','M',1, 4.99,14.68,23.66,34.12,45.44,52.80,121.81,'NATIONAL'),
    ('2026-03-11','KWACK Eunwoo', 'KOR','M',2, 4.94,14.63,23.72,34.60,46.12,53.57,119.22,'NATIONAL'),
    ('2026-03-11','KIM Yerim',    'KOR','F',1, 5.61,15.64,24.84,35.51,46.79,54.07,117.03,'NATIONAL'),
    ('2026-03-11','KIM Yerim',    'KOR','F',2, 5.72,15.81,25.03,35.73,47.08,54.42,118.01,'NATIONAL'),
    # 2026-03-13
    ('2026-03-13','YEO Chanhyuk', 'KOR','M',1, 4.90,14.64,23.78,34.43,45.71,52.92,120.07,'NATIONAL'),
    ('2026-03-13','YEO Chanhyuk', 'KOR','M',2, 4.96,14.87,24.04,34.68,45.94,53.25,119.61,'NATIONAL'),
    ('2026-03-13','KWACK Eunwoo', 'KOR','M',1, 4.98,14.74,23.88,34.56,46.00,53.55,117.78,'NATIONAL'),
    ('2026-03-13','KWACK Eunwoo', 'KOR','M',2, 5.08,14.93,24.18,34.93,46.35,53.76,118.84,'NATIONAL'),
    ('2026-03-13','SONG Youngmin','KOR','M',1, 4.99,14.75,23.97,34.76,46.36,53.90,117.63,'NATIONAL'),
    ('2026-03-13','SONG Youngmin','KOR','M',2, 5.10,14.99,24.34,35.24,47.09,54.84,114.01,'NATIONAL'),
    ('2026-03-13','KIM Yerim',    'KOR','F',1, 5.60,15.70,24.98,35.82,47.34,54.75,116.89,'NATIONAL'),
    ('2026-03-13','KIM Yerim',    'KOR','F',2, 5.77,16.06,25.55,36.65,48.36,56.00,112.76,'NATIONAL'),
    ('2026-03-13','KIM Jisoo',    'KOR','M',1, 5.05,14.83,23.93,34.51,45.74,52.96,121.57,'NATIONAL'),
    ('2026-03-13','HONG Sujung',  'KOR','F',1, 5.38,15.32,24.56,35.31,46.81,54.18,119.53,'NATIONAL'),
    # 2026-03-17 남자 (코리아컵)
    ('2026-03-17','JUNG Seunggi', 'KOR','M',1, 4.78,14.34,23.49,34.33,45.81,53.18,118.69,'COMPETITION'),
    ('2026-03-17','JUNG Seunggi', 'KOR','M',2, 4.77,14.34,23.51,34.34,45.73,53.12,118.69,'COMPETITION'),
    ('2026-03-17','YEO Chanhyuk', 'KOR','M',1, 4.75,14.34,23.58,34.52,45.99,53.35,118.61,'COMPETITION'),
    ('2026-03-17','YEO Chanhyuk', 'KOR','M',2, 4.86,14.92,24.36,35.52,47.16,54.59,117.85,'COMPETITION'),
    ('2026-03-17','KIM Jisoo',    'KOR','M',1, 4.73,14.29,23.51,34.51,46.11,53.56,116.74,'COMPETITION'),
    ('2026-03-17','KIM Jisoo',    'KOR','M',2, 4.73,14.34,23.60,34.64,46.26,53.77,112.41,'COMPETITION'),
    ('2026-03-17','SONG Youngmin','KOR','M',1, 4.70,14.27,23.68,34.82,46.70,54.36,114.08,'COMPETITION'),
    ('2026-03-17','SONG Youngmin','KOR','M',2, 4.65,14.19,23.48,34.56,46.57,54.33,114.64,'COMPETITION'),
    ('2026-03-17','KWACK Eunwoo', 'KOR','M',1, 4.82,14.46,23.76,34.87,46.89,54.71,113.38,'COMPETITION'),
    ('2026-03-17','KWACK Eunwoo', 'KOR','M',2, 4.85,14.52,23.90,35.16,47.10,54.89,113.59,'COMPETITION'),
    # 2026-03-17 여자 (코리아컵)
    ('2026-03-17','HONG Sujung',  'KOR','F',1, 5.21,15.06,24.45,35.53,47.67,55.62,112.07,'COMPETITION'),
    ('2026-03-17','HONG Sujung',  'KOR','F',2, 5.26,15.20,24.62,35.73,47.46,55.04,115.86,'COMPETITION'),
    ('2026-03-17','KIM Yerim',    'KOR','F',1, 5.43,15.41,24.94,36.26,48.14,55.80,114.93,'COMPETITION'),
    ('2026-03-17','KIM Yerim',    'KOR','F',2, 5.49,15.53,24.97,36.14,47.92,55.62,112.07,'COMPETITION'),
]

df_new = pd.DataFrame(records, columns=[
    'date','name','nat','gender','run',
    'start_time','int1','int2','int3','int4','finish','speed','format'
])

# 기상 데이터 병합
for col in ['air_temp','humidity_pct','pressure_hpa','wind_speed_ms','dewpoint_c']:
    df_new[col] = df_new['date'].map({k: v[col] for k, v in weather.items()})

# athlete_id 매핑
df_new['athlete_id'] = df_new['name'].map(athlete_ids)

# is_normal = True (정상완주)
df_new['is_normal'] = True
df_new['status'] = 'OK'

# 기존 CSV 로드
df_old = pd.read_csv('skeleton_records.csv')

# id 부여
df_new['id'] = range(int(df_old['id'].max()) + 1, int(df_old['id'].max()) + 1 + len(df_new))

# 없는 컬럼 None으로
for col in ['session','start_no','ice_temp_est','temp_avg','seg1','seg2','seg3','seg4','seg5']:
    df_new[col] = None

# 컬럼 순서 맞추기
df_new = df_new[df_old.columns]

# 합치기
df_combined = pd.concat([df_old, df_new], ignore_index=True)
df_combined.to_csv('skeleton_records.csv', index=False, encoding='utf-8-sig')

print(f'기존: {len(df_old)}건 → 추가: {len(df_new)}건 → 최종: {len(df_combined)}건')
print()
print('추가된 데이터 샘플:')
print(df_new[['date','name','run','start_time','finish','speed','air_temp','dewpoint_c','athlete_id','is_normal']].to_string(index=False))
