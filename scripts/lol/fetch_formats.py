#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Liquipedia -> data-raw/lol/formats_<year>.json：每个赛区这一年全部赛事页的赛制、日期、奖金、晋级去向，
加三个国际赛。真实赛制（策划稿里程碑 M3）照这份数据做。

    PYTHONIOENCODING=utf-8 python scripts/lol/fetch_formats.py [--year 2026]

只走 api.php 的 action=query：先 list=prefixsearch 列出「LPL/2026/」这类前缀下的所有页面，
再按 50 个一批取原文（fetch_liquipedia.wikitext）。限速、缓存、UA 都在 fetchlib.py 里。
"""
from __future__ import annotations

import argparse, json, re, sys, urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_liquipedia import API, OUT, sess, wikitext  # noqa: E402

LEAGUES_BY_YEAR = {
    2026: {
        'LPL': 'LPL', 'LCK': 'LCK', 'LEC': 'LEC', 'LCS': 'LCS', 'LCP': 'LCP', 'CBLOL': 'CBLOL',
        'LCK CL': 'LCK CL', 'LFL': 'LFL', 'NACL': 'North American Challengers League', 'PCS': 'PCS',
        'Circuito Desafiante': 'Circuito Desafiante',
    },
    # the historical entries: the leagues as they were called that year
    2016: {
        # Liquipedia files the 2016 LCS under its regions and the Challengers under CK
        'LPL': 'LPL', 'LCK': 'LCK', 'EU LCS': 'LCS/Europe', 'NA LCS': 'LCS/North America', 'LMS': 'LMS', 'CBLOL': 'CBLOL',
        'LSPL': 'LSPL', 'Challengers Korea': 'CK', 'EU CS': 'Challenger Series/Europe', 'NA CS': 'Challenger Series/North America',
    },
    2022: {
        'LPL': 'LPL', 'LCK': 'LCK', 'LEC': 'LEC', 'LCS': 'LCS', 'PCS': 'PCS', 'CBLOL': 'CBLOL',
        'LDL': 'LDL', 'LCK CL': 'LCK CL', 'LFL': 'LFL', 'LCS Academy': 'LCS Academy League',
        'CBLOL Academy': 'CBLOL/Academy',
    },
}
INTERNATIONAL = ['First Stand Tournament/{y}', 'Mid-Season Invitational/{y}', 'World Championship/{y}']


def prefix_pages(s, prefix: str) -> list[str]:
    out, cont = [], {}
    while True:
        q = dict(action='query', list='prefixsearch', pssearch=prefix, pslimit='100', format='json', formatversion='2', **cont)
        d = json.loads(s.get(f'{API}?{urllib.parse.urlencode(q)}'))
        out += [p['title'] for p in d.get('query', {}).get('prefixsearch', [])]
        if 'continue' not in d:
            return out
        cont = {'psoffset': d['continue']['psoffset']}


def section(text: str, name: str) -> str | None:
    m = re.search(r'^==\s*' + name + r'\s*==\s*$(.*?)(?=^==[^=])', text, flags=re.M | re.S)
    return m.group(1).strip() if m else None


def field(text: str, key: str) -> str | None:
    m = re.search(r'^\|\s*' + key + r'\s*=\s*(.*)$', text, flags=re.M)
    return m.group(1).strip() if m and m.group(1).strip() else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--year', type=int, default=2026)
    y = ap.parse_args().year
    s = sess()
    titles: dict[str, list[str]] = {}
    for key, prefix in LEAGUES_BY_YEAR[y].items():
        found = [t for t in prefix_pages(s, f'{prefix}/{y}') if t == f'{prefix}/{y}' or t.startswith(f'{prefix}/{y}/')]
        titles[key] = found
    titles['international'] = [t.format(y=y) for t in INTERNATIONAL]
    pages = wikitext(s, [t for ts in titles.values() for t in ts])
    out = {}
    for group, ts in titles.items():
        for t in ts:
            text = pages.get(t)
            if not text:
                continue
            fmt = section(text, 'Format')
            out[t] = dict(
                group=group,
                start=field(text, 'sdate'), end=field(text, 'edate'),
                prize=field(text, 'prizepool') or field(text, 'prizepoolusd'),
                teams=field(text, 'team_number'), location=field(text, 'city') or field(text, 'location'),
                format=fmt,
                # where the top of this event goes next, as written on the page
                qualifies=sorted(set(re.findall(r'qualif\w* (?:for|to) \[\[([^\]|]+)', text, flags=re.I))),
                children=sorted({c for c in re.findall(r'\[\[(?:\.\./|' + re.escape(t) + r'/)([^\]|#]+)', text)}),
            )
    dst = OUT / f'formats_{y}.json'
    json.dump(dict(source='Liquipedia (CC BY-SA 3.0)，赛事页 Format 一节与信息框', year=y, pages=out),
              open(dst, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    for group, ts in titles.items():
        have = [t for t in ts if t in out]
        print(f'  {group:20s} {len(have)} 页（有赛制说明 {sum(1 for t in have if out[t]["format"])}）')
    print(f'-> {dst}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
