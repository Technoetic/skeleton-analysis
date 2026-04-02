"""
봅슬레이 국제대회 PDF 17개를 파싱하여 bobsled_intl_parsed.csv로 저장하는 스크립트.

PDF 포맷 유형:
  A) World Cup 2017 (168097, 168098): 5개 중간시간 → int1~int4만 사용 (5번째 무시), 2 runs
  B) Olympics 2018 (192800, 192803): 4개 중간시간, 4 runs, Rk 열 포함
  C) IBSF sanctioned 2021-2023 (501649~502670): 4개 중간시간, 2 or 4 runs
  D) Korea Cup 2025 (504918, 504923): 4개 중간시간, 2 runs, 속도 없음
"""

import pdfplumber
import pandas as pd
import re
import os

PDF_FOLDER = r"c:\Users\Admin\Desktop\박사논문\경기기록 데이터\봅슬레이 데이터\봅슬레이 국제대회 데이터"
OUTPUT_CSV = r"c:\Users\Admin\Desktop\박사논문\예측모델\bobsled_intl_parsed.csv"

# PDF metadata mapping
PDF_META = {
    "Result_168097.pdf": {"date": "2017-03-18", "gender": "M", "session": "BMW IBSF World Cup 2016/17 PyeongChang 2-man", "format_type": "worldcup", "num_runs": 2},
    "Result_168098.pdf": {"date": "2017-03-18", "gender": "W", "session": "BMW IBSF World Cup 2016/17 PyeongChang Women", "format_type": "worldcup", "num_runs": 2},
    "Result_192800.pdf": {"date": "2018-02-19", "gender": "M", "session": "2018 PyeongChang Olympics 2-man", "format_type": "olympic", "num_runs": 4},
    "Result_192803.pdf": {"date": "2018-02-21", "gender": "W", "session": "2018 PyeongChang Olympics Women", "format_type": "olympic", "num_runs": 4},
    "Result_501649.pdf": {"date": "2021-03-25", "gender": "M", "session": "IBSF Sanctioned Pyeongchang 2021 2-man (4 heats)", "format_type": "ibsf", "num_runs": 4},
    "Result_501650.pdf": {"date": "2021-03-24", "gender": "W", "session": "IBSF Sanctioned Pyeongchang 2021 2-woman (2 heats)", "format_type": "ibsf", "num_runs": 2},
    "Result_501651.pdf": {"date": "2021-03-24", "gender": "M", "session": "IBSF Sanctioned Pyeongchang 2021 2-man (2 heats)", "format_type": "ibsf", "num_runs": 2},
    "Result_501652.pdf": {"date": "2021-03-25", "gender": "W", "session": "IBSF Sanctioned Pyeongchang 2021 2-woman (4 heats)", "format_type": "ibsf", "num_runs": 4},
    "Result_501655.pdf": {"date": "2021-03-18", "gender": "M", "session": "IBSF Sanctioned Pyeongchang 2021 2-man (2 heats) Mar18", "format_type": "ibsf", "num_runs": 2},
    "Result_501666.pdf": {"date": "2021-03-12", "gender": "M", "session": "IBSF Sanctioned Pyeongchang 2021 2-man (2 heats) Mar12", "format_type": "ibsf", "num_runs": 2},
    "Result_501672.pdf": {"date": "2021-03-12", "gender": "W", "session": "IBSF Sanctioned Pyeongchang 2021 2-woman (2 heats) Mar12", "format_type": "ibsf", "num_runs": 2},
    "Result_502285.pdf": {"date": "2022-03-10", "gender": "M", "session": "IBSF Sanctioned Pyeongchang 2022 2-man", "format_type": "ibsf", "num_runs": 2},
    "Result_502286.pdf": {"date": "2022-03-10", "gender": "W", "session": "IBSF Sanctioned Pyeongchang 2022 2-woman", "format_type": "ibsf", "num_runs": 2},
    "Result_502666.pdf": {"date": "2023-03-10", "gender": "M", "session": "IBSF Sanctioned Pyeongchang 2023 2-man", "format_type": "ibsf", "num_runs": 2},
    "Result_502670.pdf": {"date": "2023-03-11", "gender": "W", "session": "IBSF Sanctioned Pyeongchang 2023 2-woman", "format_type": "ibsf", "num_runs": 2},
    "Result_504918.pdf": {"date": "2025-02-27", "gender": "M", "session": "2025 Korea Cup 2-man", "format_type": "koreacup", "num_runs": 2},
    "Result_504923.pdf": {"date": "2025-02-28", "gender": "W", "session": "2025 Korea Cup 2-woman", "format_type": "koreacup", "num_runs": 2},
}


def extract_full_text(pdf_path):
    """Extract full text from all pages of a PDF."""
    texts = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            t = page.extract_text()
            if t:
                texts.append(t)
    return "\n".join(texts)


def clean_rank_parens(val):
    """Remove rank indicators like (1), (2), =7 from time values."""
    if val is None:
        return None
    # Remove patterns like (1), (=2), =7, etc.
    val = re.sub(r'\s*[\(=]\d+\)?', '', val).strip()
    if val == '' or val == 'DNF' or val == 'DNS' or val == 'DSQ' or val == 'DQB':
        return val
    return val


def parse_time(val):
    """Parse a time string, return float or None."""
    if val is None:
        return None
    val = str(val).strip()
    val = re.sub(r'\s*[\(=]\d+\)?', '', val).strip()
    if val in ('', 'DNF', 'DNS', 'DSQ', 'DQB'):
        return None
    # Handle times like 1:00.84
    if ':' in val:
        return None  # These are total times or abnormal, skip
    try:
        return float(val)
    except ValueError:
        return None


def parse_worldcup(text, meta):
    """
    Parse World Cup 2017 format (168097, 168098).
    5 intermediate times: start_time, int1, int2, int3, int4, int5, finish, speed
    We map: start_time=col0, int1=col1, int2=col2, int3=col3, int4=col4, (skip int5), finish=col5, speed=col6

    Each team has a rank line (pilot) and a brakeman line underneath.
    Format for ranked teams with 2 runs:
      Rk StartNo NAT PILOT_NAME  st int1 int2 int3 int4 finish speed  Total
                     BRAKEMAN_NAME st int1 int2 int3 int4 finish speed  +diff

    Teams ranked 20+ in 168097 only did 1 run (no brakeman run line with times).
    """
    records = []
    lines = text.split('\n')

    i = 0
    current_rank = None
    current_start_no = None
    current_nat = None
    current_pilot = None
    current_brakeman = None
    pilot_runs = []
    brakeman_runs = []

    # Pattern for a pilot line (starts with rank number, start_no, nat code)
    # e.g. "1 6 GER FRIEDRICH Francesco 4.89 (1) 14.28 (1) ..."
    # or "19 19 KOR KIM Donghyun 4.99(12) ..."
    pilot_pat = re.compile(
        r'^(\d+)\s+(\d+)\s+([A-Z]{3})\s+(.*?)\s+'
        r'(\d+\.\d+)\s*[\(=]?\d*\)?\s+'
        r'(\d+\.\d+)\s*[\(=]?\d*\)?\s+'
        r'(\d+\.\d+)\s*[\(=]?\d*\)?\s+'
        r'(\d+\.\d+)\s*[\(=]?\d*\)?\s+'
        r'(\d+\.\d+)\s*[\(=]?\d*\)?\s+'
        r'(\d+\.\d+)\s*[\(=]?\d*\)?\s*'
        r'(\d+\.\d+)?\s*'  # speed (optional)
    )

    # Pattern for DSQ/DNS pilot line
    dsq_pilot_pat = re.compile(r'^(?:(\d+)\s+)?(\d+)\s+([A-Z]{3})\s+(.*?)\s+(DNS|DSQ|DNF|DQB)')

    # Brakeman line (no rank, no start_no, no nat - just name and times)
    brakeman_pat = re.compile(
        r'^([A-Z][A-Za-z\s\.\-]+?)\s+'
        r'(\d+\.\d+)\s*[\(=]?\d*\)?\s+'
        r'(\d+\.\d+)\s*[\(=]?\d*\)?\s+'
        r'(\d+\.\d+)\s*[\(=]?\d*\)?\s+'
        r'(\d+\.\d+)\s*[\(=]?\d*\)?\s+'
        r'(\d+\.\d+)\s*[\(=]?\d*\)?\s+'
        r'(\d+\.\d+)\s*[\(=]?\d*\)?\s*'
        r'(\d+\.\d+)?\s*'  # speed (optional)
    )

    # Brakeman with no times (1-run teams)
    brakeman_notime_pat = re.compile(r'^([A-Z][A-Za-z\s\.\-]+?)$')

    def flush_team():
        nonlocal current_rank, current_start_no, current_nat, current_pilot, current_brakeman
        nonlocal pilot_runs, brakeman_runs

        if current_pilot is None:
            return

        for run_idx, prun in enumerate(pilot_runs):
            run_num = run_idx + 1
            # prun has 6 values: start_time, int1, int2, int3, int4(skip), finish, speed
            # Actually worldcup has 5 intermediate + finish = 6 time values + speed
            # start_time, i1, i2, i3, i4, finish, speed
            # We take first 4 intermediate: i1 i2 i3 i4 (skip 5th)
            rec = {
                'file': meta['_filename'],
                'date': meta['date'],
                'session': meta['session'],
                'gender': meta['gender'],
                'format': 'OFFICIAL',
                'nat': current_nat,
                'start_no': current_start_no,
                'pilot': current_pilot,
                'brakeman': current_brakeman if current_brakeman else '',
                'run': run_num,
                'status': prun.get('status', 'OK'),
                'start_time': prun.get('start_time'),
                'int1': prun.get('int1'),
                'int2': prun.get('int2'),
                'int3': prun.get('int3'),
                'int4': prun.get('int4'),
                'finish': prun.get('finish'),
                'speed': prun.get('speed'),
            }
            records.append(rec)

        current_rank = None
        current_start_no = None
        current_nat = None
        current_pilot = None
        current_brakeman = None
        pilot_runs = []
        brakeman_runs = []

    while i < len(lines):
        line = lines[i].strip()

        # Skip header/footer lines
        if (line.startswith('BMW IBSF') or line.startswith('OFFICIAL RESULTS') or
            line.startswith('Results subject') or line.startswith('Result after') or
            line.startswith('Rk') or line.startswith('Peter') or line.startswith('Jin') or
            'DATA - Service' in line or 'sleds entered' in line or
            line.startswith('BIB') or line.startswith('Team RUS') or
            line == '' or line.startswith('DNF ') or 'Jury President' in line):
            i += 1
            continue

        # Try pilot pattern
        m = pilot_pat.match(line)
        if m:
            flush_team()
            current_rank = int(m.group(1))
            current_start_no = int(m.group(2))
            current_nat = m.group(3)
            current_pilot = m.group(4).strip()

            # World Cup format: start, int1, int2, int3, int4, finish, speed
            # Same column structure as other formats (6 time values + speed)
            vals = [m.group(j) for j in range(5, 11)]  # 6 time values
            speed_val = m.group(11)

            run_data = {
                'start_time': parse_time(vals[0]),
                'int1': parse_time(vals[1]),
                'int2': parse_time(vals[2]),
                'int3': parse_time(vals[3]),
                'int4': parse_time(vals[4]),
                'finish': parse_time(vals[5]),
                'speed': parse_time(speed_val),
                'status': 'OK',
            }
            pilot_runs.append(run_data)
            i += 1
            continue

        # Try DSQ/DNS pilot
        m_dsq = dsq_pilot_pat.match(line)
        if m_dsq and not line.startswith('DNF'):
            flush_team()
            current_rank = int(m_dsq.group(1)) if m_dsq.group(1) else None
            current_start_no = int(m_dsq.group(2))
            current_nat = m_dsq.group(3)
            current_pilot = m_dsq.group(4).strip()
            status = m_dsq.group(5)
            pilot_runs.append({'start_time': None, 'int1': None, 'int2': None,
                             'int3': None, 'int4': None, 'finish': None, 'speed': None,
                             'status': status})
            i += 1
            continue

        # Try brakeman with times
        m_b = brakeman_pat.match(line)
        if m_b and current_pilot:
            current_brakeman = m_b.group(1).strip()
            vals = [m_b.group(j) for j in range(2, 8)]
            speed_val = m_b.group(8)

            # For 2-run format, brakeman line is run 2
            run_data = {
                'start_time': parse_time(vals[0]),
                'int1': parse_time(vals[1]),
                'int2': parse_time(vals[2]),
                'int3': parse_time(vals[3]),
                'int4': parse_time(vals[4]),
                'finish': parse_time(vals[5]),
                'speed': parse_time(speed_val),
                'status': 'OK',
            }
            brakeman_runs.append(run_data)
            # In worldcup, brakeman line = run 2 data
            pilot_runs.append(run_data)
            i += 1
            continue

        # Brakeman name only (no times - 1 run teams or DSQ)
        if current_pilot and not current_brakeman:
            # Check if this line looks like a name (possibly with DSQ/DNS/DQB suffix)
            cleaned_line = re.sub(r'\s+(DSQ|DNS|DNF|DQB)\s*$', '', line).strip()
            m_bn = brakeman_notime_pat.match(cleaned_line)
            if m_bn and cleaned_line and cleaned_line[0].isupper() and not any(kw in cleaned_line for kw in ['BMW', 'OFFICIAL', 'Result', 'Peter', 'Jin', 'Rk', 'BIB', 'Team']):
                name_candidate = m_bn.group(1).strip()
                # Must look like a name (letters, spaces, dots, hyphens only)
                if re.match(r'^[A-Za-z\s\.\-]+$', name_candidate) and len(name_candidate) > 2:
                    current_brakeman = name_candidate
                    i += 1
                    continue

        i += 1

    flush_team()
    return records


def parse_olympic(text, meta):
    """
    Parse Olympics 2018 format (192800, 192803).
    4 runs per team, each run on separate lines.

    Format:
    Rk BibNo NOC PILOT_NAME  start Rk int1 Rk int2 Rk int3 Rk int4 Rk finish Rk +behind speed mph
       (blank)  BRAKEMAN_NAME  start Rk int1 Rk ... (run 2)
       (blank)  (blank)        start Rk int1 Rk ... (run 3)
       (blank)  (blank)        start Rk int1 Rk ... (run 4)
       Total: X:XX.XX

    After top 20, teams only do 3 runs (top 20 -> 4 runs in heats 1-2, then top 20 -> heats 3-4)
    Actually in the Olympics, all 30 do 2 runs, top 20 do 4 runs.
    """
    records = []
    lines = text.split('\n')

    # Remove header/footer lines and collect data lines
    data_lines = []
    for line in lines:
        stripped = line.strip()
        if (stripped.startswith('Olympic Sliding') or stripped.startswith('올림픽') or
            stripped.startswith('Centre olympique') or stripped.startswith('2-man') or
            stripped.startswith('남자') or stripped.startswith('Women') or
            stripped.startswith('봅슬레이') or stripped.startswith('Bob à') or
            stripped.startswith('MON ') or stripped.startswith('WED ') or
            stripped.startswith('THU ') or stripped.startswith('TUE ') or
            stripped.startswith('FRI ') or stripped.startswith('SAT ') or
            stripped.startswith('SUN ') or
            stripped.startswith('Official Results') or stripped.startswith('공식') or
            stripped.startswith('Start Record') or stripped.startswith('Time ') or
            stripped.startswith('Date ') or stripped.startswith('GER FRIEDRICH') or
            stripped.startswith('USA MEYERS') or
            stripped.startswith('Bib ') or stripped.startswith('Rk ') or
            stripped.startswith('No. ') or stripped.startswith('Note:') or
            stripped.startswith('In the listing') or stripped.startswith('The above') or
            stripped.startswith('Legend:') or stripped.startswith('=') or
            stripped.startswith('Int.') or stripped.startswith('DQB ') or
            stripped.startswith('SR ') or stripped.startswith('TR ') or
            stripped.startswith('SERGEEVA') or
            stripped.startswith('BOBM') or stripped.startswith('BOBW') or
            'Report Created' in stripped or
            stripped == '' or stripped.startswith('Résultats')):
            continue
        data_lines.append(stripped)

    i = 0

    # Pattern for first line of a team (pilot, run 1)
    # Rk BibNo NAT PilotName  start Rk int1 Rk int2 Rk int3 Rk int4 Rk finish Rk +behind speed mph
    # e.g. "1 6 CAN KRIPPS Justin 4.93 =7 14.34 4 22.99 3 32.86 2 38.97 2 49.10 2 +0.02 135.8 84.4"
    # or "1 7 GER FRIEDRICH Francesco 4.86 1 14.25 1 22.98 2 32.90 =3 39.06 4 49.22 5 +0.14 135.8 84.4"
    pilot_pat = re.compile(
        r'^(\d+)\s+(\d+)\s+([A-Z]{3})\s+(.*?)\s+'
        r'(\d+\.\d+)\s*=?(\d+)\s+'
        r'(\d+\.\d+)\s*=?(\d+)\s+'
        r'(\d+\.\d+)\s*=?(\d+)\s+'
        r'(\d+\.\d+)\s*=?(\d+)\s+'
        r'(\d+\.\d+)\s*=?(\d+)\s+'
        r'(\d+\.\d+)\s*=?(\d+)\s+'
        r'([+\d\.]+)\s+'
        r'(\d+\.\d+)\s+(\d+\.\d+)'
    )
    # Groups: (1)rank (2)bib (3)nat (4)name (5)start (6)rk (7)int1 (8)rk (9)int2 (10)rk
    #         (11)int3 (12)rk (13)int4 (14)rk (15)finish (16)rk (17)behind (18)speed_kmh (19)speed_mph

    # DQB/DSQ/DNS line
    dsq_pat = re.compile(r'^(?:(\d+)\s+)?(\d+)\s+([A-Z]{3})\s+(.*?)\s+(DQB|DSQ|DNS|DNF)')

    # Subsequent run line (no rank, no bib, no nat - just name or times)
    # Brakeman run 2: "KOPACZ Alexander 4.93 =5 14.36 =4 23.06 4 33.00 3 39.17 =2 49.39 =3 +0.12 134.4 83.5"
    # Run 3 (no name): "4.93 =6 14.34 =4 22.96 2 32.82 2 38.94 2 49.09 =3 +0.13 135.7 84.3"
    # Run 4: "4.92 =3 14.34 =3 23.00 3 32.91 3 39.06 3 49.28 3 +0.07 134.8 83.8"

    brakeman_run_pat = re.compile(
        r'^([A-Z][A-Za-z\s\.\-]+?)\s+'
        r'(\d+\.\d+)\s*=?(\d+)\s+'
        r'(\d+\.\d+)\s*=?(\d+)\s+'
        r'(\d+\.\d+)\s*=?(\d+)\s+'
        r'(\d+\.\d+)\s*=?(\d+)\s+'
        r'(\d+\.\d+)\s*=?(\d+)\s+'
        r'(\d+\.\d+)\s*=?(\d+)\s+'
        r'([+\d\.]+)\s+'
        r'(\d+\.\d+)\s+(\d+\.\d+)'
    )
    # Groups: (1)name (2)start (3)rk (4)int1 (5)rk (6)int2 (7)rk (8)int3 (9)rk
    #         (10)int4 (11)rk (12)finish (13)rk (14)behind (15)speed_kmh (16)speed_mph

    # Pure time run line (runs 3, 4) - no name, just times
    time_run_pat = re.compile(
        r'^(\d+\.\d+)\s*=?(\d+)\s+'
        r'(\d+\.\d+)\s*=?(\d+)\s+'
        r'(\d+\.\d+)\s*=?(\d+)\s+'
        r'(\d+\.\d+)\s*=?(\d+)\s+'
        r'(\d+\.\d+)\s*=?(\d+)\s+'
        r'(\d+\.\d+)\s*=?(\d+)\s+'
        r'([+\d\.]+)\s+'
        r'(\d+\.\d+)\s+(\d+\.\d+)'
    )
    # Groups: (1)start (2)rk (3)int1 (4)rk (5)int2 (6)rk (7)int3 (8)rk
    #         (9)int4 (10)rk (11)finish (12)rk (13)behind (14)speed_kmh (15)speed_mph

    # Total line
    total_pat = re.compile(r'^Total:\s+')

    teams = []
    current_team = None

    while i < len(data_lines):
        line = data_lines[i]

        # Try Total line
        if total_pat.match(line):
            if current_team:
                teams.append(current_team)
                current_team = None
            i += 1
            continue

        # Try pilot line
        m = pilot_pat.match(line)
        if m:
            if current_team:
                teams.append(current_team)
            current_team = {
                'rank': int(m.group(1)),
                'start_no': int(m.group(2)),
                'nat': m.group(3),
                'pilot': m.group(4).strip(),
                'brakeman': '',
                'runs': [],
            }
            run_data = {
                'start_time': parse_time(m.group(5)),
                'int1': parse_time(m.group(7)),
                'int2': parse_time(m.group(9)),
                'int3': parse_time(m.group(11)),
                'int4': parse_time(m.group(13)),
                'finish': parse_time(m.group(15)),
                'speed': parse_time(m.group(18)),
                'status': 'OK',
            }
            current_team['runs'].append(run_data)
            i += 1
            continue

        # Try DSQ line
        m_dsq = dsq_pat.match(line)
        if m_dsq:
            if current_team:
                teams.append(current_team)
            current_team = {
                'rank': int(m_dsq.group(1)) if m_dsq.group(1) else None,
                'start_no': int(m_dsq.group(2)),
                'nat': m_dsq.group(3),
                'pilot': m_dsq.group(4).strip(),
                'brakeman': '',
                'runs': [{'start_time': None, 'int1': None, 'int2': None, 'int3': None,
                          'int4': None, 'finish': None, 'speed': None,
                          'status': m_dsq.group(5)}],
            }
            i += 1
            continue

        # Try brakeman run line (has name + times)
        m_b = brakeman_run_pat.match(line)
        if m_b and current_team:
            current_team['brakeman'] = m_b.group(1).strip()
            run_data = {
                'start_time': parse_time(m_b.group(2)),
                'int1': parse_time(m_b.group(4)),
                'int2': parse_time(m_b.group(6)),
                'int3': parse_time(m_b.group(8)),
                'int4': parse_time(m_b.group(10)),
                'finish': parse_time(m_b.group(12)),
                'speed': parse_time(m_b.group(15)),  # group(15) = speed_kmh
                'status': 'OK',
            }
            current_team['runs'].append(run_data)
            i += 1
            continue

        # Try pure time run line (runs 3, 4)
        m_t = time_run_pat.match(line)
        if m_t and current_team:
            run_data = {
                'start_time': parse_time(m_t.group(1)),
                'int1': parse_time(m_t.group(3)),
                'int2': parse_time(m_t.group(5)),
                'int3': parse_time(m_t.group(7)),
                'int4': parse_time(m_t.group(9)),
                'finish': parse_time(m_t.group(11)),
                'speed': parse_time(m_t.group(14)),  # group(14) = speed_kmh
                'status': 'OK',
            }
            current_team['runs'].append(run_data)
            i += 1
            continue

        # Brakeman name only (for DQB teams)
        if current_team and not current_team['brakeman']:
            cleaned_line = re.sub(r'\s+(DSQ|DNS|DNF|DQB)\s*$', '', line).strip()
            name_match = re.match(r'^([A-Z][A-Za-z\s\.\-]+?)$', cleaned_line)
            if name_match and cleaned_line:
                candidate = name_match.group(1).strip()
                if len(candidate) > 2 and not any(kw in candidate for kw in ['Total', 'Note', 'Legend']):
                    current_team['brakeman'] = candidate
                    i += 1
                    continue

        # Check for DQB continuation lines
        if line in ('DQB', 'DSQ', 'DNS', 'DNF'):
            i += 1
            continue

        i += 1

    if current_team:
        teams.append(current_team)

    # Convert teams to records
    for team in teams:
        for run_idx, run in enumerate(team['runs']):
            rec = {
                'file': meta['_filename'],
                'date': meta['date'],
                'session': meta['session'],
                'gender': meta['gender'],
                'format': 'OFFICIAL',
                'nat': team['nat'],
                'start_no': team['start_no'],
                'pilot': team['pilot'],
                'brakeman': team['brakeman'],
                'run': run_idx + 1,
                'status': run['status'],
                'start_time': run['start_time'],
                'int1': run['int1'],
                'int2': run['int2'],
                'int3': run['int3'],
                'int4': run['int4'],
                'finish': run['finish'],
                'speed': run['speed'],
            }
            records.append(rec)

    return records


def parse_ibsf(text, meta):
    """
    Parse IBSF sanctioned race format (2021-2023) and Korea Cup (2025).
    4 intermediate times, 2 or 4 runs.

    Header columns: Rk No Nat Name Int.1 Int.2 Int.3 Int.4 Start Finish Time TopSpeed
    Or for 2023+: Rk Start No. Nat Name ...

    Team block structure:
    Rk StartNo NAT PILOT times speed
                   BRAKEMAN times speed  (run 2)
                   (times)              (run 3)
                   (times)              (run 4)
    Total: X:XX.XX
    """
    records = []
    lines = text.split('\n')

    # Filter out header/footer
    data_lines = []
    for line in lines:
        stripped = line.strip()
        if (stripped.startswith('IBSF') or stripped.startswith('OFFICIAL') or
            stripped.startswith('Results subject') or stripped.startswith('Result after') or
            stripped.startswith('Start') and ('Finish' in stripped or 'Int.' in stripped) or
            stripped.startswith('Rk') or
            stripped.startswith('Time') or
            'sleds entered' in stripped or
            stripped.startswith('DNF Did') or stripped.startswith('DNF ') and 'Not' in stripped or
            'Page' in stripped and any(c.isdigit() for c in stripped) and 'MAR' in stripped or
            stripped.startswith('2025 KOREA') or
            stripped == ''):
            continue
        data_lines.append(stripped)

    # Pattern for pilot line (first run)
    # "1 7 KOR WON Yunjong 5.86 (2) 15.76 (2) 24.66 (1) 34.91 (1) 45.62 (1) 52.27 (1) 127.52"
    # Also handles: "1 1 KOR SUK Youngjin 5.39 (2) 15.08 (1) ..." (Korea Cup, no speed?)
    # Some have no start_no in Rk column: "5 NGR YUSUF Hammed 5.90 (4) ..."
    pilot_pat = re.compile(
        r'^(\d+)\s+(\d+)\s+([A-Z]{3})\s+(.*?)\s+'
        r'(\d+\.\d+)\s*\(\s*\d+\)\s+'
        r'(\d+\.\d+)\s*\(\s*\d+\)\s+'
        r'(\d+\.\d+)\s*\(\s*\d+\)\s+'
        r'(\d+\.\d+)\s*\(\s*\d+\)\s+'
        r'(\d+\.\d+)\s*\(\s*\d+\)\s+'
        r'(\d+\.\d+)\s*\(\s*\d+\)\s*'
        r'([+\d\.]+)?\s*'  # +behind or speed
        r'(\d+\.\d+)?'     # speed if behind present
    )

    # Pilot without rank (DNF continuation etc) - like "5 NGR YUSUF ..."
    pilot_norankcheck = re.compile(
        r'^(\d+)\s+([A-Z]{3})\s+(.*?)\s+'
        r'(\d+\.\d+)\s*\(\s*\d+\)\s+'
    )

    # Brakeman/subsequent run with times
    brakeman_or_run_pat = re.compile(
        r'^([A-Z][A-Za-z\s\.\-\']+?)\s+'
        r'(\d+\.\d+)\s*\(\s*\d+\)\s+'
        r'(\d+\.\d+)\s*\(\s*\d+\)\s+'
        r'(\d+\.\d+)\s*\(\s*\d+\)\s+'
        r'(\d+\.\d+)\s*\(\s*\d+\)\s+'
        r'(\d+\.\d+)\s*\(\s*\d+\)\s+'
        r'(\d+\.\d+)\s*\(\s*\d+\)\s*'
        r'([+\d\.]+)?\s*'
        r'(\d+\.\d+)?'
    )

    # Pure time run (runs 3, 4) - no name
    time_run_pat = re.compile(
        r'^(\d+\.\d+)\s*\(\s*\d+\)\s+'
        r'(\d+\.\d+)\s*\(\s*\d+\)\s+'
        r'(\d+\.\d+)\s*\(\s*\d+\)\s+'
        r'(\d+\.\d+)\s*\(\s*\d+\)\s+'
        r'(\d+\.\d+)\s*\(\s*\d+\)\s+'
        r'(\d+\.\d+)\s*\(\s*\d+\)\s*'
        r'([+\d\.]+)?\s*'
        r'(\d+\.\d+)?'
    )

    # DNF run line - partial times then DNF
    dnf_run_pat = re.compile(
        r'.*?(\d+\.\d+)\s*\(\s*\d+\)\s+.*?DNF'
    )

    # Brakeman DNF line
    brakeman_dnf_pat = re.compile(
        r'^([A-Z][A-Za-z\s\.\-\']+?)\s+'
        r'(\d+\.\d+)\s*\(\s*\d+\)\s+'
        r'.*?DNF'
    )

    # DSQ line for ranked teams
    dsq_line_pat = re.compile(r'.*DSQ\s+')

    total_pat = re.compile(r'^Total:')

    def parse_speed_behind(behind_str, speed_str):
        """Parse the speed value from behind/speed combo."""
        if speed_str:
            return parse_time(speed_str)
        if behind_str:
            v = parse_time(behind_str)
            if v and v > 50:  # It's actually a speed value, not +behind
                return v
        return None

    def extract_run_data(vals, behind_str=None, speed_str=None):
        """Extract run data from 6 time values."""
        return {
            'start_time': parse_time(vals[0]),
            'int1': parse_time(vals[1]),
            'int2': parse_time(vals[2]),
            'int3': parse_time(vals[3]),
            'int4': parse_time(vals[4]),
            'finish': parse_time(vals[5]),
            'speed': parse_speed_behind(behind_str, speed_str),
            'status': 'OK',
        }

    teams = []
    current_team = None

    i = 0
    while i < len(data_lines):
        line = data_lines[i]

        # Total line
        if total_pat.match(line):
            if current_team:
                teams.append(current_team)
                current_team = None
            i += 1
            continue

        # Try pilot pattern
        m = pilot_pat.match(line)
        if m:
            if current_team:
                teams.append(current_team)

            current_team = {
                'rank': int(m.group(1)),
                'start_no': int(m.group(2)),
                'nat': m.group(3),
                'pilot': m.group(4).strip(),
                'brakeman': '',
                'runs': [],
            }

            vals = [m.group(j) for j in range(5, 11)]
            run_data = extract_run_data(vals, m.group(11), m.group(12))
            current_team['runs'].append(run_data)
            i += 1
            continue

        # Try pilot without rank column (e.g. "5 NGR YUSUF ...")
        m_nr = pilot_norankcheck.match(line)
        if m_nr and not current_team:
            # This might be a team where start_no appears without rank
            full_match = re.match(
                r'^(\d+)\s+([A-Z]{3})\s+(.*?)\s+'
                r'(\d+\.\d+)\s*\(\s*\d+\)\s+'
                r'(\d+\.\d+)\s*\(\s*\d+\)\s+'
                r'(\d+\.\d+)\s*\(\s*\d+\)\s+'
                r'(\d+\.\d+)\s*\(\s*\d+\)\s+'
                r'(\d+\.\d+)\s*\(\s*\d+\)\s+'
                r'(\d+\.\d+)\s*\(\s*\d+\)\s*'
                r'([+\d\.]+)?\s*'
                r'(\d+\.\d+)?',
                line
            )
            if full_match:
                if current_team:
                    teams.append(current_team)
                current_team = {
                    'rank': None,
                    'start_no': int(full_match.group(1)),
                    'nat': full_match.group(2),
                    'pilot': full_match.group(3).strip(),
                    'brakeman': '',
                    'runs': [],
                }
                vals = [full_match.group(j) for j in range(4, 10)]
                run_data = extract_run_data(vals, full_match.group(10), full_match.group(11))
                current_team['runs'].append(run_data)
                i += 1
                continue

        # Try brakeman/subsequent run with name
        m_b = brakeman_or_run_pat.match(line)
        if m_b and current_team:
            name = m_b.group(1).strip()
            if not current_team['brakeman']:
                current_team['brakeman'] = name
            vals = [m_b.group(j) for j in range(2, 8)]
            run_data = extract_run_data(vals, m_b.group(8), m_b.group(9))
            current_team['runs'].append(run_data)
            i += 1
            continue

        # Try pure time run line
        m_t = time_run_pat.match(line)
        if m_t and current_team:
            vals = [m_t.group(j) for j in range(1, 7)]
            run_data = extract_run_data(vals, m_t.group(7), m_t.group(8))
            current_team['runs'].append(run_data)
            i += 1
            continue

        # Try brakeman DNF line
        m_bdnf = brakeman_dnf_pat.match(line)
        if m_bdnf and current_team:
            if not current_team['brakeman']:
                current_team['brakeman'] = m_bdnf.group(1).strip()
            current_team['runs'].append({
                'start_time': parse_time(m_bdnf.group(2)),
                'int1': None, 'int2': None, 'int3': None, 'int4': None,
                'finish': None, 'speed': None, 'status': 'DNF',
            })
            i += 1
            continue

        # DNF run line (partial times)
        if 'DNF' in line and current_team:
            # Try to extract start time at least
            st_match = re.match(r'.*?(\d+\.\d+)\s*\(\s*\d+\)', line)
            start_t = parse_time(st_match.group(1)) if st_match else None
            current_team['runs'].append({
                'start_time': start_t,
                'int1': None, 'int2': None, 'int3': None, 'int4': None,
                'finish': None, 'speed': None, 'status': 'DNF',
            })
            i += 1
            continue

        # DSQ line
        if 'DSQ' in line and current_team:
            # Check if this is a brakeman DSQ line (e.g. "ALAWODE Sekinat ... DSQ")
            name_match = re.match(r'^([A-Z][A-Za-z\s\.\-\']+?)\s+\d', line)
            if name_match and not current_team['brakeman']:
                current_team['brakeman'] = name_match.group(1).strip()
            current_team['runs'].append({
                'start_time': None, 'int1': None, 'int2': None, 'int3': None,
                'int4': None, 'finish': None, 'speed': None, 'status': 'DSQ',
            })
            i += 1
            continue

        # Brakeman name only (for special cases)
        if current_team and not current_team['brakeman']:
            cleaned_line = re.sub(r'\s+(DSQ|DNS|DNF|DQB)\s*$', '', line).strip()
            name_match = re.match(r'^([A-Z][A-Za-z\s\.\-\']+?)$', cleaned_line)
            if name_match and cleaned_line:
                candidate = name_match.group(1).strip()
                if len(candidate) > 2:
                    current_team['brakeman'] = candidate
                    i += 1
                    continue

        i += 1

    if current_team:
        teams.append(current_team)

    # Convert to records
    for team in teams:
        for run_idx, run in enumerate(team['runs']):
            rec = {
                'file': meta['_filename'],
                'date': meta['date'],
                'session': meta['session'],
                'gender': meta['gender'],
                'format': 'OFFICIAL',
                'nat': team['nat'],
                'start_no': team['start_no'],
                'pilot': team['pilot'],
                'brakeman': team['brakeman'],
                'run': run_idx + 1,
                'status': run['status'],
                'start_time': run['start_time'],
                'int1': run['int1'],
                'int2': run['int2'],
                'int3': run['int3'],
                'int4': run['int4'],
                'finish': run['finish'],
                'speed': run['speed'],
            }
            records.append(rec)

    return records


def parse_pdf(pdf_path, meta):
    """Parse a single PDF file."""
    text = extract_full_text(pdf_path)
    fmt = meta['format_type']

    if fmt == 'worldcup':
        return parse_worldcup(text, meta)
    elif fmt == 'olympic':
        return parse_olympic(text, meta)
    elif fmt in ('ibsf', 'koreacup'):
        return parse_ibsf(text, meta)
    else:
        print(f"  Unknown format type: {fmt}")
        return []


def main():
    all_records = []

    pdf_files = sorted(PDF_META.keys())

    print(f"파싱할 PDF 파일 수: {len(pdf_files)}")
    print("=" * 80)

    for fname in pdf_files:
        pdf_path = os.path.join(PDF_FOLDER, fname)
        if not os.path.exists(pdf_path):
            print(f"  [경고] 파일 없음: {pdf_path}")
            continue

        meta = PDF_META[fname].copy()
        meta['_filename'] = fname

        records = parse_pdf(pdf_path, meta)

        # Count KOR records
        kor_count = sum(1 for r in records if r['nat'] == 'KOR')
        ok_count = sum(1 for r in records if r['status'] == 'OK')

        print(f"  {fname}: {len(records)}개 레코드 (KOR: {kor_count}, OK: {ok_count})")
        all_records.extend(records)

    print("=" * 80)

    # Create DataFrame
    df = pd.DataFrame(all_records)

    # Add columns that exist in the target CSV but aren't in PDF
    df['id'] = range(1, len(df) + 1)
    df['athlete_id'] = ''
    df['temp_avg'] = ''
    df['air_temp'] = ''
    df['humidity_pct'] = ''
    df['pressure_hpa'] = ''
    df['dewpoint_c'] = ''
    df['wind_speed_ms'] = ''
    df['seg1'] = ''
    df['seg2'] = ''
    df['seg3'] = ''
    df['seg4'] = ''
    df['seg5'] = ''
    df['is_normal'] = ''

    # Reorder columns to match target CSV
    cols = ['id', 'file', 'date', 'session', 'gender', 'format', 'nat', 'start_no',
            'pilot', 'brakeman', 'run', 'status', 'start_time', 'int1', 'int2', 'int3',
            'int4', 'finish', 'speed', 'athlete_id', 'temp_avg', 'air_temp',
            'humidity_pct', 'pressure_hpa', 'dewpoint_c', 'wind_speed_ms',
            'seg1', 'seg2', 'seg3', 'seg4', 'seg5', 'is_normal']
    df = df[cols]

    # Save to CSV
    df.to_csv(OUTPUT_CSV, index=False, encoding='utf-8-sig')

    # Summary
    print(f"\n총 레코드 수: {len(df)}")
    print(f"저장 위치: {OUTPUT_CSV}")
    print(f"\n--- 국가별 레코드 수 ---")
    print(df['nat'].value_counts().to_string())
    print(f"\n--- 파일별 레코드 수 ---")
    print(df.groupby('file').size().to_string())
    print(f"\n--- 성별 레코드 수 ---")
    print(df['gender'].value_counts().to_string())
    print(f"\n--- 상태별 레코드 수 ---")
    print(df['status'].value_counts().to_string())

    # KOR detail
    kor_df = df[df['nat'] == 'KOR']
    print(f"\n--- KOR 선수 상세 ({len(kor_df)}개 레코드) ---")
    kor_pilots = kor_df[['file', 'pilot', 'brakeman', 'run', 'start_time', 'finish', 'speed']].to_string()
    print(kor_pilots)


if __name__ == '__main__':
    main()
