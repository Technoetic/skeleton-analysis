"""
루지 국제대회 여자 싱글 PDF 파싱 스크립트 v3
"""
import sys
sys.stdout.reconfigure(encoding='utf-8')

import fitz
import re
import os
import pandas as pd
import numpy as np

FOLDER = r'C:\Users\Admin\Desktop\박사논문\경기기록 데이터\루지 데이터\루지 국제대회 여자 싱글'

FILE_META = {
    'ach-women-s-singles-pyeongchang-result.pdf': {
        'date': '2025-02-16', 'event': 'ACh Women Singles', 'format': 'COMPETITION',
        'gender': 'W', 'type': 'fil'
    },
    'nc-women-s-singles-pyeongchang-result.pdf': {
        'date': '2025-02-15', 'event': 'Nationscup Women Singles', 'format': 'COMPETITION',
        'gender': 'W', 'type': 'fil'
    },
    'rl2wcwomen-11.pdf': {
        'date': '2017-02-18', 'event': 'WC Women 2016/2017', 'format': 'COMPETITION',
        'gender': 'W', 'type': 'fil'
    },
    'rlncwomen-13.pdf': {
        'date': '2017-02-17', 'event': 'NC Women 2016/2017', 'format': 'COMPETITION',
        'gender': 'W', 'type': 'fil'
    },
    'lugwsingles-c73b2-1-0.pdf': {
        'date': '2018-02-13', 'event': 'OWG 2018 Final', 'format': 'COMPETITION',
        'gender': 'W', 'type': 'olympic_final'
    },
    'owg2018-lug-lugwsingles-day-1-group-a-run-1-2.pdf': {
        'date': '2018-02-08', 'event': 'OWG 2018 TR D1 GA', 'format': 'training',
        'gender': 'W', 'type': 'olympic_training'
    },
    'training-results-women-day-1-group-b-run-1-2.pdf': {
        'date': '2018-02-08', 'event': 'OWG 2018 TR D1 GB', 'format': 'training',
        'gender': 'W', 'type': 'olympic_training'
    },
    'women-s-training-results-day-2-run-3-4.pdf': {
        'date': '2018-02-10', 'event': 'OWG 2018 TR D2 GA', 'format': 'training',
        'gender': 'W', 'type': 'olympic_training'
    },
    'women-s-training-results-day-2-group-b-run-3-4.pdf': {
        'date': '2018-02-08', 'event': 'OWG 2018 TR D1 GB dup', 'format': 'training',
        'gender': 'W', 'type': 'olympic_training'
    },
    'revised-women-s-training-results-day-3-run-5-xxiii-owg.pdf': {
        'date': '2018-02-11', 'event': 'OWG 2018 TR D3 R5', 'format': 'training',
        'gender': 'W', 'type': 'olympic_training'
    },
    'women-s-training-results-day-3-run-6-xxiii-owg-2018.pdf': {
        'date': '2018-02-11', 'event': 'OWG 2018 TR D3 R6', 'format': 'training',
        'gender': 'W', 'type': 'olympic_training'
    },
    'wc-women-s-doubles-pyeongchang-result-2nd-run.pdf': None,
}


# ──────────────────────────────────────────────────
# FIL/Swiss Timing 포맷 (한 줄에 여러 시간값+순위괄호)
# ──────────────────────────────────────────────────
def parse_fil_format(text, meta):
    records = []
    air_temp = ice_temp = None
    m_w = re.search(r'Air:\s*([-\d.]+)\s*°C.*Ice:\s*([-\d.]+)\s*°C', text)
    if m_w:
        air_temp = float(m_w.group(1))
        ice_temp = float(m_w.group(2))

    lines = text.split('\n')
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if re.match(r'^[A-Z]{3}$', line):
            nat = line
            i += 1
            if i >= len(lines):
                break
            name_line = lines[i].strip()
            nm = re.match(r'^(?:Q\s+)?([A-Z][A-Za-z\-\'\s,]+?)(?:\s+Q)?$', name_line)
            if not nm:
                i += 1
                continue
            name = nm.group(1).strip()
            i += 1
            run_num = 0
            while i < len(lines):
                rl = lines[i].strip()
                if re.match(r'^[A-Z]{3}$', rl) or re.match(r'^\d{1,2}$', rl):
                    break
                if 'sleds' in rl.lower():
                    i += 1
                    break
                clean = re.sub(r'^[Q#]\s*', '', rl)
                tvs = re.findall(r'(\d+\.\d{2,3})\s*(?:\(\s*[=]?\d+\s*\))?', clean)
                if len(tvs) >= 4:
                    all_t = list(tvs)
                    j = i + 1
                    while j < len(lines) and len(all_t) < 10:
                        nl = lines[j].strip()
                        if re.match(r'^[A-Z]{3}$', nl) or re.match(r'^\d{1,2}$', nl):
                            break
                        if 'Total' in nl or 'sleds' in nl.lower():
                            break
                        more = re.findall(r'(\d+\.\d{2,3})\s*(?:\(\s*[=]?\d+\s*\))?', nl)
                        if more:
                            all_t.extend(more)
                            j += 1
                        elif re.match(r'^\+\d+\.\d+', nl):
                            j += 1
                        else:
                            break
                    run_num += 1
                    rec = classify_fil_times(all_t, nat, name, run_num, meta, air_temp, ice_temp)
                    if rec:
                        records.append(rec)
                    i = j
                else:
                    if 'Total' in rl:
                        i += 1
                        if i < len(lines) and re.match(r'^[+]?\d+\.\d+', lines[i].strip()):
                            i += 1
                    else:
                        i += 1
        else:
            i += 1
    return records


def classify_fil_times(times_str, nat, name, run_num, meta, air_temp, ice_temp):
    floats = [float(t) for t in times_str]
    start_time = int1 = int2 = int3 = int4 = finish = speed = None
    for v in floats:
        if 3.0 <= v <= 7.0 and start_time is None:
            start_time = v
        elif 14.0 <= v <= 22.0 and int1 is None:
            int1 = v
        elif 23.0 <= v <= 28.0 and int2 is None:
            int2 = v
        elif 28.0 <= v <= 37.0 and int3 is None:
            int3 = v
        elif 38.0 <= v <= 45.0 and int4 is None:
            int4 = v
        elif 46.0 <= v <= 58.0 and finish is None:
            finish = v
        elif v > 80 and speed is None:
            speed = v
    if finish is None and int4 and int4 > 45:
        finish = int4
        int4 = None
    if not start_time or not finish or finish < 44 or finish > 58:
        return None
    return {
        'date': meta['date'], 'event': meta['event'], 'format': meta['format'],
        'gender': meta['gender'], 'nat': nat, 'name': name, 'run': run_num,
        'start_time': start_time, 'int1': int1, 'int2': int2, 'int3': int3,
        'int4': int4, 'finish': finish, 'speed': speed,
        'air_temp': air_temp, 'ice_temp': ice_temp,
        'is_normal': True, 'status': 'OK',
    }


# ──────────────────────────────────────────────────
# 올림픽 포맷 공통: 줄 단위 숫자를 순서대로 읽는 파서
# ──────────────────────────────────────────────────
def extract_numeric_lines(lines):
    """각 줄을 토큰 리스트로 분류. 한 줄에 '시간 순위'가 합쳐진 경우 분리."""
    result = []
    for l in lines:
        s = l.strip()
        if not s:
            result.append(('empty', s))
        elif s in ('DNF', 'DNS', 'DSQ'):
            result.append(('dnf', s))
        elif s.startswith('Total:'):
            result.append(('total', s))
        elif re.match(r'^\+\d+\.\d+$', s):
            result.append(('behind', s))
        elif s == '0.000':
            result.append(('behind', s))
        elif re.match(r'^\d{1,2}\s+[A-Z]{3}$', s):
            result.append(('bib_noc', s))
        elif re.match(r'^[A-Z]{3}$', s):
            result.append(('noc', s))
        elif re.match(r'^\d+\.\d{1,3}$', s):
            result.append(('time', float(s)))
        elif re.match(r'^=?\d{1,2}$', s):
            result.append(('rank', s))
        elif re.match(r'^[A-Z][A-Za-z\-\'\s]+$', s) and len(s) > 3:
            result.append(('name', s))
        else:
            # 합쳐진 형태: "4.385 14" 또는 "4.387=15" 또는 "16.465 12"
            m = re.match(r'^(\d+\.\d{2,3})\s*[= ]*(\d{1,2})$', s)
            if m:
                result.append(('time', float(m.group(1))))
                result.append(('rank', m.group(2)))
            else:
                result.append(('other', s))
    return result


def parse_olympic_final(text, meta):
    """올림픽 본선: bib_noc → name → [4런 x (start, rk, int1, rk, int2, rk, int3, rk, speed_km, speed_mph, finish, rk, behind)]"""
    records = []
    lines = text.split('\n')
    tokens = extract_numeric_lines(lines)

    i = 0
    while i < len(tokens):
        ttype, tval = tokens[i]

        if ttype == 'bib_noc':
            nat = tval.split()[-1]
            i += 1
            if i >= len(tokens) or tokens[i][0] != 'name':
                continue
            name = tokens[i][1]
            i += 1

            # 4런 수집
            run_num = 0
            while i < len(tokens) and run_num < 4:
                if tokens[i][0] == 'bib_noc':
                    break
                if tokens[i][0] == 'total':
                    i += 1
                    if i < len(tokens) and tokens[i][0] == 'behind':
                        i += 1
                    break

                if tokens[i][0] == 'time':
                    v = tokens[i][1]
                    if 3.0 <= v <= 7.0:
                        # 런 시작
                        time_vals = [v]
                        i += 1
                        while i < len(tokens) and len(time_vals) < 7:
                            tt, tv = tokens[i]
                            if tt == 'time':
                                time_vals.append(tv)
                            elif tt == 'rank':
                                pass
                            elif tt == 'behind':
                                i += 1
                                break
                            elif tt in ('bib_noc', 'total', 'noc', 'name'):
                                break
                            i += 1

                        # time_vals: start, int1, int2, int3, speed_km, speed_mph, finish
                        if len(time_vals) >= 7:
                            run_num += 1
                            finish = time_vals[6]
                            if 44 <= finish <= 58:
                                records.append({
                                    'date': meta['date'], 'event': meta['event'],
                                    'format': meta['format'], 'gender': meta['gender'],
                                    'nat': nat, 'name': name, 'run': run_num,
                                    'start_time': time_vals[0],
                                    'int1': time_vals[1], 'int2': time_vals[2],
                                    'int3': time_vals[3], 'int4': None,
                                    'finish': finish, 'speed': time_vals[4],
                                    'air_temp': None, 'ice_temp': None,
                                    'is_normal': True, 'status': 'OK',
                                })
                        continue
                    else:
                        i += 1
                else:
                    i += 1
        else:
            i += 1

    return records


def parse_olympic_training(text, meta):
    """
    올림픽 훈련: noc → name → [런수 x (start, rk, v1, rk, v2, rk, v3, rk, [v4, rk,] speed_km, speed_mph, finish, [rk,] behind)]
    v1~v3는 Int.1/Int.2/Int.3 또는 구간시간(S-1, 1-2, 2-3)
    구간시간은 7~13초, 중간시간은 16~36초
    """
    records = []
    lines = text.split('\n')
    tokens = extract_numeric_lines(lines)

    # 구간시간(segment) vs 중간시간(intermediate) 판별
    header_text = '\n'.join(lines[:40])
    is_seg = 'S-1' in header_text

    i = 0
    while i < len(tokens):
        ttype, tval = tokens[i]

        if ttype == 'noc':
            nat = tval
            i += 1
            if i >= len(tokens) or tokens[i][0] != 'name':
                continue
            name = tokens[i][1]
            i += 1

            run_num = 0
            while i < len(tokens) and run_num < 6:
                if tokens[i][0] == 'noc':
                    break

                if tokens[i][0] == 'time':
                    v = tokens[i][1]
                    if 3.0 <= v <= 7.0:
                        time_vals = [v]
                        i += 1
                        dnf = False
                        while i < len(tokens):
                            tt, tv = tokens[i]
                            if tt == 'time':
                                time_vals.append(tv)
                            elif tt == 'rank':
                                pass
                            elif tt == 'behind':
                                i += 1
                                break
                            elif tt == 'dnf':
                                dnf = True
                                i += 1
                                break
                            elif tt in ('noc', 'name'):
                                break
                            i += 1

                            # 충분한 값 수집 확인
                            if is_seg:
                                # segment: start, seg1~seg4(or 5), speed_km, speed_mph, finish → 8~9개
                                if len(time_vals) >= 8:
                                    break
                            else:
                                # intermediate: start, int1, int2, int3, speed_km, speed_mph, finish → 7개
                                if len(time_vals) >= 7:
                                    break

                        if dnf:
                            run_num += 1
                            continue

                        if is_seg and len(time_vals) >= 8:
                            run_num += 1
                            finish = time_vals[-1]
                            speed = time_vals[-3]
                            if 44 <= finish <= 58 and 3 <= time_vals[0] <= 7:
                                records.append({
                                    'date': meta['date'], 'event': meta['event'],
                                    'format': meta['format'], 'gender': meta['gender'],
                                    'nat': nat, 'name': name, 'run': run_num,
                                    'start_time': time_vals[0],
                                    'int1': None, 'int2': None, 'int3': None, 'int4': None,
                                    'finish': finish, 'speed': speed,
                                    'air_temp': None, 'ice_temp': None,
                                    'is_normal': True, 'status': 'OK',
                                })
                        elif not is_seg and len(time_vals) >= 7:
                            run_num += 1
                            finish = time_vals[6]
                            speed = time_vals[4]
                            int1 = time_vals[1] if time_vals[1] > 10 else None
                            int2 = time_vals[2] if time_vals[2] > 20 else None
                            int3 = time_vals[3] if time_vals[3] > 28 else None
                            if 44 <= finish <= 58 and 3 <= time_vals[0] <= 7:
                                records.append({
                                    'date': meta['date'], 'event': meta['event'],
                                    'format': meta['format'], 'gender': meta['gender'],
                                    'nat': nat, 'name': name, 'run': run_num,
                                    'start_time': time_vals[0],
                                    'int1': int1, 'int2': int2, 'int3': int3, 'int4': None,
                                    'finish': finish, 'speed': speed,
                                    'air_temp': None, 'ice_temp': None,
                                    'is_normal': True, 'status': 'OK',
                                })
                        continue
                    else:
                        i += 1
                else:
                    i += 1
        else:
            i += 1

    return records


# ──────────────────────────────────────────────────
# 메인
# ──────────────────────────────────────────────────
def main():
    all_records = []
    parser_map = {
        'fil': parse_fil_format,
        'olympic_final': parse_olympic_final,
        'olympic_training': parse_olympic_training,
    }

    for fname, meta in FILE_META.items():
        if meta is None:
            print(f'[건너뜀] {fname} (더블스)')
            continue

        path = os.path.join(FOLDER, fname)
        if not os.path.exists(path):
            print(f'[경고] {path} 없음')
            continue

        doc = fitz.open(path)
        full_text = ''
        for page in doc:
            full_text += page.get_text() + '\n'
        doc.close()

        parser = parser_map.get(meta['type'])
        if not parser:
            print(f'[경고] 알 수 없는 타입: {meta["type"]}')
            continue

        recs = parser(full_text, meta)
        print(f'[{fname}] → {len(recs)}건 파싱')
        all_records.extend(recs)

    if not all_records:
        print('\n파싱된 기록 없음!')
        return

    df = pd.DataFrame(all_records)

    # 중복 제거 (같은 파일 중복 방지)
    before = len(df)
    df = df.drop_duplicates(subset=['date', 'event', 'name', 'run', 'finish'], keep='first')
    if before != len(df):
        print(f'\n중복 제거: {before}건 → {len(df)}건')

    print(f'\n{"="*60}')
    print(f'파싱 결과 요약')
    print(f'{"="*60}')
    print(f'총 기록: {len(df)}건')
    print(f'선수 수: {df["name"].nunique()}명')
    print(f'국가 수: {df["nat"].nunique()}개국')
    print(f'날짜 범위: {df["date"].min()} ~ {df["date"].max()}')
    print(f'finish 범위: {df["finish"].min():.3f} ~ {df["finish"].max():.3f}초')
    print(f'start_time 범위: {df["start_time"].min():.3f} ~ {df["start_time"].max():.3f}초')

    print(f'\n대회별 기록:')
    summary = df.groupby(['date', 'event']).agg(
        건수=('finish', 'count'),
        최고=('finish', 'min'),
        평균=('finish', 'mean'),
        최저=('finish', 'max')
    )
    print(summary.to_string())

    print(f'\n국가별 선수:')
    print(df.groupby('nat')['name'].nunique().sort_values(ascending=False).head(15).to_string())

    # 한국 선수 기록
    kor = df[df['nat'] == 'KOR']
    if len(kor) > 0:
        print(f'\n=== 한국 선수 기록 ({len(kor)}건) ===')
        for _, r in kor.sort_values('finish').iterrows():
            print(f'  {r["date"]} {r["name"]:<25s} R{r["run"]} '
                  f'start={r["start_time"]:.3f} finish={r["finish"]:.3f}')

    # CSV 저장
    outpath = os.path.join(os.path.dirname(__file__), 'luge_women_intl_parsed.csv')
    df.to_csv(outpath, index=False, encoding='utf-8-sig')
    print(f'\n→ {outpath} 저장 ({len(df)}건)')

    # 상위 기록
    print(f'\n=== 상위 15건 ===')
    for _, r in df.nsmallest(15, 'finish').iterrows():
        print(f'  {r["date"]} {r["nat"]} {r["name"]:<28s} R{r["run"]} '
              f'start={r["start_time"]:.3f} finish={r["finish"]:.3f} '
              f'speed={r["speed"] if pd.notna(r.get("speed")) else "N/A"}')

    return df


if __name__ == '__main__':
    main()
