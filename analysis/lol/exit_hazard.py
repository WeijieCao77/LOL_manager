# -*- coding: utf-8 -*-
"""
离场率：某年在一级联赛打了 20 场以上的人，之后两年再也没在任何联赛出现过的比例，按年龄。

    PYTHONIOENCODING=utf-8 python analysis/lol/exit_hazard.py

引擎的退役规则按它标定。原规则是无畏契约的（29 岁才开始有 6% 的概率），照那个规则
模拟世界的首发平均年龄会涨到 27.1，真实是 23.7。
"""
import collections, csv, os
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
DATA = os.environ.get('LOL_DATA_DIR') or os.path.join(os.path.dirname(REPO), 'lol选手', 'data')
TIER1 = {'LPL', 'LCK', 'LEC', 'EU LCS', 'LCS', 'NA LCS', 'LTA N', 'LTA S', 'CBLOL', 'LCP', 'PCS', 'LMS', 'VCS'}
ROLE = {'Top': 'top', 'Jungle': 'jng', 'Mid': 'mid', 'Bot': 'bot', 'Support': 'sup'}
seen = collections.defaultdict(set)            # name -> years seen anywhere
t1 = collections.defaultdict(collections.Counter)   # year -> (name,pos) -> tier-1 games
for y in range(2015, 2027):
    p = os.path.join(DATA, 'oracleselixir', f'{y}_OE.csv')
    with open(p, encoding='utf-8', errors='replace') as fh:
        rd = csv.reader(fh); h = next(rd); iL, iP, iN = h.index('league'), h.index('position'), h.index('playername')
        for r in rd:
            if r[iP] in ROLE.values() and r[iN]:
                seen[r[iN]].add(y)
                if r[iL] in TIER1: t1[y][(r[iN], r[iP])] += 1
bio = collections.defaultdict(list)
for r in csv.DictReader(open(os.path.join(DATA, 'csv', 'players_master.csv'), encoding='utf-8-sig')):
    if r['birthdate']: bio[(r['player_id'].lower(), ROLE.get(r['role']))].append(int(r['birthdate'][:4]))
stay = collections.Counter(); out = collections.Counter()
for y in range(2016, 2025):                     # need two later years to call it an exit
    for (nm, pos), g in t1[y].items():
        b = bio.get((nm.lower(), pos), [])
        if g < 20 or len(b) != 1: continue
        age = y - b[0]
        if not 17 <= age <= 33: continue
        gone = not any(yy in seen[nm] for yy in (y + 1, y + 2))
        (out if gone else stay)[age] += 1
print('年龄  人次   离场率')
for a in range(18, 33):
    n = stay[a] + out[a]
    if n >= 15: print(f' {a}  {n:5d}   {out[a] / n:.3f}')
