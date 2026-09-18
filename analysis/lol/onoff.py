# -*- coding: utf-8 -*-
"""
在场 / 缺阵：一支队的某个位置换了人，别的四个位置没动，胜率差多少。

    PYTHONIOENCODING=utf-8 python analysis/lol/onoff.py [选手ID ...]     （先跑 extract_major.py）

这是把一个人的价值从固定队友里拆出来的最干净的证据，也是比赛引擎的标定目标：
模拟里把一个主力换成替补，胜率该掉多少，就照这里的分布来。
只算「其余四个位置都是主力」的比赛——整队轮换的那种不算一个人的缺席。
"""
import collections, sys
from study_lib import load, POS


def main():
    names = set(sys.argv[1:])
    d = load()
    games = collections.defaultdict(lambda: collections.defaultdict(dict))
    res = {}
    for r in d['players']:
        if r['position'] in POS and r['line'] != 'INTL':
            games[(r['teamname'], r['year'], r['line'])][r['gameid']][r['position']] = r['playername']
            res[(r['gameid'], r['teamname'])] = r['win']
    rows = []
    for key, gs in games.items():
        main_of = {p: collections.Counter(g.get(p) for g in gs.values()).most_common(1)[0][0] for p in POS}
        for pos in POS:
            others = [p for p in POS if p != pos]
            clean = {gid: g for gid, g in gs.items() if all(g.get(p) == main_of[p] for p in others)}
            on = [res[(gid, key[0])] for gid, g in clean.items() if g.get(pos) == main_of[pos]]
            off = [res[(gid, key[0])] for gid, g in clean.items() if g.get(pos) != main_of[pos]]
            if len(on) >= 15 and len(off) >= 6:
                rows.append(dict(name=main_of[pos], pos=pos, team=key[0], year=key[1], line=key[2],
                                 on=sum(on) / len(on), n_on=len(on), off=sum(off) / len(off), n_off=len(off)))
    diffs = sorted(r['on'] - r['off'] for r in rows)
    n = len(diffs)
    print(f'主力缺阵 >= 6 场、其余四人不变的案例 {n} 个（2015–2026，四大赛区）')
    print(f'在场减缺阵的胜率差：平均 {sum(diffs) / n:+.3f}，中位 {diffs[n // 2]:+.3f}，'
          f'十分位 {diffs[n // 10]:+.2f} … {diffs[n * 9 // 10]:+.2f}')
    print('\n差距最大的 15 例：')
    for r in sorted(rows, key=lambda r: r['off'] - r['on'])[:15]:
        print(f"  {r['year']} {r['line']:4s} {r['name']:12s} {r['pos']} {r['team'][:20]:20s} 在场 {r['on']:.2f}({r['n_on']}) 缺阵 {r['off']:.2f}({r['n_off']}) 差 {r['on'] - r['off']:+.2f}")
    for nm in names:
        print(f'\n{nm}：')
        for r in sorted((r for r in rows if r['name'] == nm), key=lambda r: r['year']):
            print(f"  {r['year']} {r['team'][:20]:20s} 在场 {r['on']:.2f}({r['n_on']}) 缺阵 {r['off']:.2f}({r['n_off']}) 差 {r['on'] - r['off']:+.2f}")


if __name__ == '__main__':
    main()
