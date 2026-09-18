# -*- coding: utf-8 -*-
"""
一个人每一年的能力长什么样：把数值研究的结论落成具体数字，给人看。

    PYTHONIOENCODING=utf-8 python analysis/lol/career_profile.py Faker Uzi Deft
    （先跑 extract_major.py 和 macro_rapm.py）

个人能力六项：当年 + 前一年的数据（0.6 / 0.4），同位置同联赛同年内标准化，按场次收缩。
指挥一项是三样东西合成的，每一样都标了来源：
    45%  运营 RAPM     这个人在场时，队伍比 15 分钟局面预示的多赢多少（岭回归，三年滚动窗口，国际赛 ×3）
    25%  队伍运营残差  他所在的队当年的同一个量（和队友共享，分不开的那部分）
    30%  资历          此前在大赛区打过的场次 + 国际赛场次 ×3（对数）
这里的联赛基准用的是固定值，只为了看形状；正式管线里每个时代的基准由当时的国际赛交手记录拟合。
"""
import collections, json, math, os, sys
from study_lib import load, aggregate, zscores, POS

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = {'LCK': 79, 'LPL': 77, 'LEC': 71, 'LCS': 68}
SPREAD, SHRINK_K = 7.5, 25
RECIPE = {
    '对线': [('gd15', .45), ('cd15', .30), ('xd15', .25)],
    '操作': [('dpm', .35), ('dshare', .25), ('kda', .25), ('multi', .15)],
    '团战': [('kp', .40), ('dths', .25), ('dshare', .20)],
    '发育': [('cspm', .45), ('egpm', .35), ('gshare', .20)],
    '意识': [('vspm', .35), ('dths', .30), ('wcpm', .20), ('fb', .15)],
    '协同': [('kp', .55), ('dths', .45)],
}
SUP = {'对线': [('gd15', .5), ('xd15', .5)], '操作': [('kda', .5), ('kp', .3), ('dpm', .2)], '发育': [('vspm', .6), ('egpm', .4)]}


def main():
    names = sys.argv[1:] or ['Faker']
    d = load()
    T = aggregate(d['players'])
    Z = zscores(T)
    rapm = json.load(open(os.path.join(HERE, 'cache', 'macro_rapm.json'), encoding='utf-8'))

    # 队伍运营残差（每队每年），组内标准化
    gd_slope = collections.defaultdict(list)
    for t in d['teams']:
        if t['golddiffat15'] is not None and t['line'] != 'INTL':
            gd_slope[t['year']].append(t)
    team_resid = {}
    for y, ts in gd_slope.items():
        b = 0.55
        acc = collections.defaultdict(lambda: [0.0, 0])
        for t in ts:
            p = 1 / (1 + math.exp(-b * t['golddiffat15'] / 1000))
            acc[(t['teamname'], t['line'])][0] += (1.0 if t['win'] else 0.0) - p
            acc[(t['teamname'], t['line'])][1] += 1
        vals = {k: s / n for k, (s, n) in acc.items() if n >= 25}
        mu = sum(vals.values()) / len(vals)
        sd = (sum((v - mu) ** 2 for v in vals.values()) / len(vals)) ** .5 or 1
        for k, v in vals.items():
            team_resid[(k[0], y)] = (v - mu) / sd

    games = collections.Counter(); intl = collections.Counter()
    for r in d['players']:
        if r['position'] in POS:
            games[(r['playername'], r['year'])] += 1
            if r['line'] == 'INTL':
                intl[(r['playername'], r['year'])] += 1
    # 资历的标准化：拿所有「选手-年」的资历分布当尺子
    def exp_raw(nm, y):
        g = sum(n for (p, yy), n in games.items() if p == nm and yy < y)
        i = sum(n for (p, yy), n in intl.items() if p == nm and yy < y)
        return math.log1p(g + 3 * i)
    pool = [exp_raw(nm, y) for (nm, y) in list(games)[::7]]
    e_mu = sum(pool) / len(pool); e_sd = (sum((v - e_mu) ** 2 for v in pool) / len(pool)) ** .5

    for nm in names:
        keys = sorted(k for k in Z if k[0] == nm and k[3] != 'INTL')
        if not keys:
            print(f'{nm}：没有数据'); continue
        pos = collections.Counter(k[1] for k in keys).most_common(1)[0][0]
        print(f'\n=== {nm}（{pos}）')
        print(' 年份 队伍            场  | 对线 操作 团战 发育 意识 协同 | 指挥  ← RAPM  队伍  资历 | 个人六项均值')
        for k in keys:
            if k[1] != pos:
                continue
            y, line = k[2], k[3]
            prev = (nm, pos, y - 1, line)
            rows = [(k, .6)] + ([(prev, .4)] if prev in Z else [])
            eff = sum(T[kk]['n'] * w for kk, w in rows) / .6
            shrink = eff / (eff + SHRINK_K)
            attrs = {}
            for attr, spec in RECIPE.items():
                spec = SUP.get(attr, spec) if pos == 'sup' else spec
                acc = ws = 0.0
                for kk, w in rows:
                    have = [(f, c) for f, c in spec if f in Z[kk]]
                    if have:
                        acc += w * T[kk]['n'] * sum(Z[kk][f] * c for f, c in have) / sum(c for _, c in have)
                        ws += w * T[kk]['n']
                z = acc / ws if ws else 0.0
                attrs[attr] = max(30, min(99, round(BASE[line] + SPREAD * 1.35 * z * shrink)))
            r = rapm.get(f'{nm}|{pos}|{y}', {}).get('z', 0.0)
            tr = team_resid.get((T[k]['team'], y), 0.0)
            ex = (exp_raw(nm, y) - e_mu) / e_sd
            igl = max(35, min(97, round(60 + 12 * (.45 * r + .25 * tr + .30 * ex) + (BASE[line] - 75) * .4)))
            six = sum(attrs.values()) / 6
            print(f" {y} {T[k]['team'][:14]:14s} {T[k]['n']:4d} | " + ' '.join(f'{attrs[a]:4d}' for a in RECIPE) +
                  f" | {igl:4d}   {r:+5.2f} {tr:+5.2f} {ex:+5.2f} | {six:5.1f}")


if __name__ == '__main__':
    main()
