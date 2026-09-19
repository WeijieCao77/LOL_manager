#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
真实新秀池 -> src/data/prospects.json

    PYTHONIOENCODING=utf-8 python scripts/lol/build_prospects.py --candidates   # 1. 出候选人名单
    python scripts/lol/fetch_liquipedia.py --players                              # 2. 给缺生日的人上 Liquipedia 补
    PYTHONIOENCODING=utf-8 python scripts/lol/build_prospects.py                 # 3. 出最终的池子

没有新人入场，世界只会一年年变老（核验 check_aging：首发平均年龄两年从 24.0 到 25.9）。
和全作一样：**没有一个虚构的人**。池子里是 2025–2026 年在「世界以外」的联赛里真实打球的年轻选手：

  · Oracle's Elixir 2025–2026 里不在本作世界内的联赛（LJL、VCS、土耳其、各 ERL、拉美、阿拉伯联赛、
    LCK 学院系列……）以及世界内联赛里没进任何名单的人——有逐场数据，所以有位置、用过的英雄、相对同联赛的水平
  · LDL 2025：OE 没有 LDL 的数据，名单从 Leaguepedia 的 Team Rosters 页读（只有人名、位置、居民赛区）。
    中国的新人主要从这里来

生日、国籍、真名先查破晓项目里的 Leaguepedia 选手表，缺的去 Liquipedia 选手页补。
生日查不到的人留 `born: null` 并给一个估计年龄——引擎会标「年龄为估算」，不编生日。
"""
from __future__ import annotations

import argparse, collections, csv, hashlib, json, math, os, re, sys, urllib.parse
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from build_world import COUNTRY_ISO, DATA, POS, RESIDENCY_KEY, ROLE_CN, WORLD_LEAGUES, num  # noqa: E402
from fetchlib import Session, ROOT  # noqa: E402

YEAR = 2026
OUT = ROOT / 'data-raw' / 'lol'
MAX_AGE = 22                 # 到开局那年的年龄上限
MIN_GAMES = 12
POOL = 260
LDL_PAGES = ['LDL/2025 Season/Split 1/Team Rosters', 'LDL/2025 Season/Split 2/Team Rosters',
             'LDL/2025 Season/Split 3/Team Rosters']
# 这个联赛的平均水平，放在本作的刻度上（一级联赛首发约 66–79）。只决定新人入行时的起点，不决定上限
LEAGUE_LEVEL = collections.defaultdict(lambda: 53, {
    'LCKC': 61, 'LDL': 60, 'EM': 59, 'LFL': 58, 'PRM': 57, 'TCL': 57, 'VCS': 58, 'LJL': 55, 'PCS': 57,
    'NACL': 55, 'CD': 56, 'LES': 56, 'NLC': 54, 'LIT': 53, 'HLL': 53, 'ROL': 53, 'EBL': 53, 'AL': 53,
    'LAS': 54, 'LRN': 53, 'LRS': 53, 'LPLOL': 53, 'LCP': 62, 'CBLOL': 62, 'LCS': 64, 'LEC': 65, 'LCK': 70, 'LPL': 69,
})
SKIP = {'MSI', 'WLDs', 'FST', 'EWC', 'Asia Master', 'KeSPA', 'KeSPA Cup', 'DCup', 'AC', 'ASI', 'CCWS', 'IC', 'CT', 'NEXO', 'RL',
        'HC', 'HM', 'HW'}


def leaguepedia_ldl() -> list[dict]:
    """LDL 2025 rosters off Leaguepedia's roster pages: names, positions and residency, no statistics."""
    s = Session('lol.fandom.com', min_interval=3.0, robots_exempt=('/api.php',),
                exempt_reason='MediaWiki api.php 的只读查询，三个页面，三秒一次；Fandom 的 robots 针对的是搜索引擎爬 HTML')
    out = {}
    for page in LDL_PAGES:
        q = urllib.parse.urlencode(dict(action='parse', page=page, prop='wikitext', format='json', formatversion='2'))
        try:
            d = json.loads(s.get(f'https://lol.fandom.com/api.php?{q}'))
        except Exception as e:                                    # a missing split page is not fatal
            print(f'  ! {page}: {e}', file=sys.stderr)
            continue
        text = d.get('parse', {}).get('wikitext', '')
        for blk in text.split('==={{team|')[1:]:
            team = blk.split('}}')[0]
            for line in re.findall(r'ExtendedRoster/Line\|([^\n]*)', blk):
                f = dict(x.split('=', 1) for x in line.split('|') if '=' in x)
                pos = {'Top': 'top', 'Jungle': 'jng', 'Mid': 'mid', 'Bot': 'bot', 'Support': 'sup'}.get(f.get('role1', ''))
                ign = re.sub(r'\s*\(.*\)$', '', f.get('player', '')).strip()
                if not ign or not pos:
                    continue
                native = re.search(r'\(([^)]+)\)', f.get('name', ''))
                out[(ign, pos)] = dict(ign=ign, pos=pos, league='LDL', team=team, games=0, z=0.0, champs=[],
                                       real=(native.group(1) if native else None) or re.sub(r'\s*\(.*\)$', '', f.get('name', '')) or None,
                                       country=f.get('flag'), residency=f.get('res'))
    return list(out.values())


def oe_candidates(world_igns: set[str]) -> list[dict]:
    world_codes = {c for c, *_ in WORLD_LEAGUES[YEAR]}
    agg = collections.defaultdict(lambda: dict(n=0, k=0.0, d=0.0, a=0.0, dpm=[], champs=collections.Counter(), teams=collections.Counter(), last=''))
    for y in (YEAR - 1, YEAR):
        path = os.path.join(DATA, 'oracleselixir', f'{y}_OE.csv')
        with open(path, encoding='utf-8', errors='replace') as fh:
            for r in csv.DictReader(fh):
                if r['position'] not in POS or r['league'] in SKIP:
                    continue
                nm = (r.get('playername') or '').strip()
                if not nm or nm.lower() in world_igns:
                    continue
                a = agg[(nm, r['position'], r['league'])]
                a['n'] += 1
                a['k'] += num(r.get('kills')) or 0; a['d'] += num(r.get('deaths')) or 0; a['a'] += num(r.get('assists')) or 0
                v = num(r.get('dpm'))
                if v is not None:
                    a['dpm'].append(v)
                if r.get('champion'):
                    a['champs'][r['champion']] += 1
                a['teams'][r['teamname']] += 1
                a['last'] = max(a['last'], r['date'][:10])
    # how good, against the others in the same league and position
    groups = collections.defaultdict(list)
    for (nm, pos, lg), a in agg.items():
        if a['n'] >= MIN_GAMES:
            kda = math.log((a['k'] + a['a'] + 1) / (a['d'] + 1))
            dpm = sum(a['dpm']) / len(a['dpm']) if a['dpm'] else None
            groups[(pos, lg)].append([nm, pos, lg, a, kda, dpm])
    best = {}
    for (pos, lg), rows in groups.items():
        for idx in (4, 5):
            vals = [r[idx] for r in rows if r[idx] is not None]
            if len(vals) >= 4:
                mu = sum(vals) / len(vals); sd = (sum((v - mu) ** 2 for v in vals) / len(vals)) ** .5 or 1.0
                for r in rows:
                    r.append(((r[idx] - mu) / sd) if r[idx] is not None else 0.0)
            else:
                for r in rows:
                    r.append(0.0)
        for nm, pos, lg, a, _kda, _dpm, zk, zd in rows:
            z = (zk * .6 + zd * .4) * a['n'] / (a['n'] + 25)
            row = dict(ign=nm, pos=pos, league=lg, team=a['teams'].most_common(1)[0][0], games=a['n'], z=round(z, 2),
                       champs=[c for c, _ in a['champs'].most_common(6)], last=a['last'])
            if nm not in best or a['n'] > best[nm]['games']:
                best[nm] = row
    return [r for r in best.values() if r.get('last', '') >= f'{YEAR - 1}-06-01']        # still active lately


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--candidates', action='store_true')
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)

    world = json.load(open(ROOT / 'src' / 'data' / 'world.json', encoding='utf-8'))
    world_igns = {p['ign'].lower() for p in world['players']}
    role_of = {'Top': 'top', 'Jungle': 'jng', 'Mid': 'mid', 'Bot': 'bot', 'Support': 'sup'}
    bio = collections.defaultdict(list)
    for row in csv.DictReader(open(os.path.join(DATA, 'csv', 'players_master.csv'), encoding='utf-8-sig')):
        bio[row['player_id'].lower()].append(row)

    cands = oe_candidates(world_igns)
    ldl = [r for r in leaguepedia_ldl() if r['ign'].lower() not in world_igns and r['ign'] not in {c['ign'] for c in cands}]
    print(f'OE 候选人 {len(cands)}；LDL 2025 名单 {len(ldl)}', file=sys.stderr)
    cands += ldl

    lp_path = OUT / 'prospect_births.json'
    lp = json.load(open(lp_path, encoding='utf-8'))['players'] if lp_path.exists() else {}
    for c in cands:
        rows = bio.get(c['ign'].lower(), [])
        hit = [b for b in rows if role_of.get(b.get('role')) == c['pos'] and b.get('is_retired') != '1']
        b = hit[0] if len(hit) == 1 else (rows[0] if len(rows) == 1 else None)
        c['born'] = (b or {}).get('birthdate') or None
        c['real'] = c.get('real') or (b or {}).get('name_cn') or (b or {}).get('real_name') or None
        c['country'] = c.get('country') or (b or {}).get('country')
        c['residency'] = c.get('residency') or (b or {}).get('residency')
        extra = lp.get(c['ign'])
        if extra:
            c['born'] = c['born'] or extra.get('born')
            c['country'] = c['country'] or extra.get('country')
            c['real'] = c['real'] or extra.get('name') or extra.get('romanized')

    if args.candidates:
        json.dump(cands, open(OUT / 'prospect_candidates.json', 'w', encoding='utf-8'), ensure_ascii=False)
        print(f'-> prospect_candidates.json  {len(cands)} 人，其中缺生日 {sum(1 for c in cands if not c["born"])}', file=sys.stderr)
        return 0

    # 生日查不到的人里混着老将（FATE 就是）。2024 年之前在职业赛场出现过的，不是新人
    veterans = set()
    for y in range(2015, YEAR - 2):
        path = os.path.join(DATA, 'oracleselixir', f'{y}_OE.csv')
        if os.path.exists(path):
            with open(path, encoding='utf-8', errors='replace') as fh:
                rd = csv.reader(fh); head = next(rd); i_nm = head.index('playername')
                for row in rd:
                    if row[i_nm]:
                        veterans.add(row[i_nm].strip().lower())
    rows = []
    for c in cands:
        if not c['born'] and c['ign'].lower() in veterans:
            continue
        age = (YEAR - int(c['born'][:4])) if c['born'] else None
        if age is not None and not (15 <= age <= MAX_AGE):
            continue
        if age is None and c['league'] != 'LDL' and c['games'] < 30:
            continue                                   # 不知道年龄、样本又少：不知道他是不是新人
        level = LEAGUE_LEVEL[c['league']] + 4.5 * c['z']
        score = level + (MAX_AGE - (age if age is not None else 20)) * 1.2
        rows.append((score, c, age, level))
    rows.sort(key=lambda x: -x[0])
    out = []
    for _score, c, age, level in rows[:POOL]:
        out.append({k: v for k, v in dict(
            id='Y' + hashlib.sha1(f"{c['ign']}|{c['pos']}".encode()).hexdigest()[:6].upper(),
            ign=c['ign'], real=c['real'], nat=COUNTRY_ISO.get(c.get('country') or ''), born=c['born'],
            age=None if c['born'] else 19, pos=ROLE_CN[c['pos']], level=int(round(max(44, min(70, level)))),
            res=RESIDENCY_KEY.get(c.get('residency') or ''), agents=c['champs'], league=c['league'], club=c['team'],
        ).items() if v is not None})
    meta = dict(built='scripts/lol/build_prospects.py',
                source="Oracle's Elixir 2025–2026 世界外联赛的逐场数据；LDL 2025 名单来自 Leaguepedia；生日与国籍来自 Leaguepedia 选手表与 Liquipedia 选手页",
                intakeFrom=YEAR + 1, count=len(out))
    json.dump(dict(meta=meta, players=out), open(ROOT / 'src' / 'data' / 'prospects.json', 'w', encoding='utf-8'),
              ensure_ascii=False, separators=(',', ':'))
    by = collections.Counter(r['league'] for r in out)
    print(f'-> src/data/prospects.json  {len(out)} 人；有生日 {sum(1 for r in out if r.get("born"))}；'
          f'按居民赛区 {dict(collections.Counter(r.get("res", "?") for r in out))}', file=sys.stderr)
    print('来源联赛：' + '  '.join(f'{k} {v}' for k, v in by.most_common(14)), file=sys.stderr)
    print('水平最高的 12 人：' + '  '.join(f"{r['ign']}({r['pos']} {r['level']} {r['league']} {r.get('born', '?')[:4]})" for r in sorted(out, key=lambda r: -r['level'])[:12]), file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
