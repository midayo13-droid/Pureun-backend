# 원본 가상문서를 seed-data/*.json 으로 변환한다. 실행: python -X utf8 convert.py
import json, re, os, datetime, openpyxl
base = os.path.dirname(os.path.abspath(__file__))
src = os.path.join(base, '..', '..', '가상문서')

def conv(v):
    if isinstance(v, datetime.datetime): return v.strftime('%Y-%m-%dT%H:%M:%S')
    if isinstance(v, datetime.date): return v.strftime('%Y-%m-%d')
    return v

def sheet(wb, name):
    rows = list(wb[name].iter_rows(values_only=True))
    h = rows[0]
    out = []
    for r in rows[1:]:
        if r[0] is None: continue
        out.append({str(k): conv(v) for k, v in zip(h, r)})
    return out

def dump(name, data):
    with open(os.path.join(base, name), 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)

wb = openpyxl.load_workbook(os.path.join(src, '대관기록_6개월_가상.xlsx'), data_only=True)
dump('rentals.json', sheet(wb, '대관기록'))
dump('orgs.json', sheet(wb, '단체목록'))
dump('blackouts.json', sheet(wb, '이용불가일'))

text = open(os.path.join(src, '챗봇용_문서.txt'), encoding='utf-8').read()
clauses = []
for m in re.finditer(r'^\[([^|\]]+)\|([^|\]]+)\|([^|\]]*)\|우선순위(\d+)\]\s*\n(.*?)(?=^\[[^|\]]+\|[^|\]]+\|[^|\]]*\|우선순위\d+\]|\Z)', text, re.S | re.M):
    clauses.append({'doc': m.group(1), 'articleLabel': m.group(2), 'title': m.group(3), 'priority': int(m.group(4)), 'body': m.group(5).strip()})
dump('clauses.json', clauses)
print(len(clauses), 'clauses')
