# -*- coding: utf-8 -*-
"""
「运营版 RAPM」：15 分钟之后的那部分胜负，该记在谁头上。

    PYTHONIOENCODING=utf-8 python analysis/lol/macro_rapm.py

每一局：y = 蓝方赢了没有 − P(蓝方赢 | 15 分钟经济差)
        也就是「按 15 分钟的局面你该赢多少，你实际多赢了多少」——对线之后的运营、团战决策、关键局处理。
对场上十个人做岭回归（蓝方 +1，红方 −1）。五个人总是一起上场，单看一年分不开；
但十二年里选手不停转会，同一个人先后和几十个不同的队友搭过，个人的那一份就能解出来。

每一个目标年份单独解一次，用的是「当年 + 前两年」的滚动窗口（权重 1 / .7 / .45），所以每个人
每一年都有自己的值，不按固定的时代硬切。国际赛（MSI、世界赛、First Stand）每局按 INTL_W 倍计：
大局观是在那里见分晓的，而且那里的对手来自别的赛区，是把个人从固定队友里拆出来的最好样本。
没有 15 分钟数据的比赛（2018 年以前的 LPL）不进模型。
"""
import collections, json, math, os, sys
import numpy as np
from study_lib import load, POS

HERE = os.path.dirname(os.path.abspath(__file__))
WINDOW = {0: 1.0, 1: .7, 2: .45}      # 距目标年份几年 -> 权重
INTL_W = 3.0
LAMBDA = 45.0            # 岭回归强度：场次少的人被拉向 0
MIN_GAMES = 40


def fit_gd15(xs, ys):
    b = 0.0
    for _ in range(100):
        p = 1 / (1 + np.exp(-b * xs))
        g = np.mean((p - ys) * xs)
        h = np.mean(p * (1 - p) * xs * xs) or 1.0
        b -= g / h
    return b


def main():
    d = load()
    gd = {(t['gameid'], t['side']): t['golddiffat15'] for t in d['teams']}
    games = collections.defaultdict(lambda: dict(Blue=[], Red=[], win=None, year=None))
    for r in d['players']:
        if r['position'] in POS and r['playername']:
            g = games[r['gameid']]
            g[r['side']].append((r['playername'], r['position']))
            g['year'] = r['year']
            if r['side'] == 'Blue':
                g['win'] = 1.0 if r['win'] else 0.0
    valid = [(gid, g) for gid, g in games.items()
             if len(g['Blue']) == 5 and len(g['Red']) == 5 and g['win'] is not None and gd.get((gid, 'Blue')) is not None]
    print(f'有 15 分钟数据的完整对局 {len(valid)} / {len(games)}', file=sys.stderr)

    # 逐年拟合 P(win | gd15)
    slope = {}
    for y in sorted({g['year'] for _, g in valid}):
        xs = np.array([gd[(gid, 'Blue')] / 1000 for gid, g in valid if g['year'] == y])
        ys = np.array([g['win'] for _, g in valid if g['year'] == y])
        slope[y] = fit_gd15(xs, ys)

    intl_games = {r['gameid'] for r in d['teams'] if r['line'] == 'INTL'}
    out = {}
    for Y in sorted({g['year'] for _, g in valid}):
        window = [(gid, g, WINDOW[Y - g['year']] * (INTL_W if gid in intl_games else 1.0))
                  for gid, g in valid if 0 <= Y - g['year'] <= 2]
        appear = collections.Counter()
        for _, g, _w in window:
            for side in ('Blue', 'Red'):
                for nm, pos in g[side]:
                    appear[(nm, pos)] += 1
        keys = sorted(k for k, n in appear.items() if n >= MIN_GAMES)
        idx = {k: i for i, k in enumerate(keys)}
        N = len(keys)
        XtX = np.zeros((N, N)); Xty = np.zeros(N)
        for gid, g, wt in window:
            p = 1 / (1 + math.exp(-slope[g['year']] * gd[(gid, 'Blue')] / 1000))
            y = g['win'] - p
            cols = [(idx.get((nm, pos)), sg) for side, sg in (('Blue', 1.0), ('Red', -1.0)) for nm, pos in g[side]]
            cols = [(i, sg) for i, sg in cols if i is not None]
            for i, si in cols:
                Xty[i] += wt * si * y
                for j, sj in cols:
                    XtX[i, j] += wt * si * sj
        w = np.linalg.solve(XtX + LAMBDA * np.eye(N), Xty)
        sd = w.std() or 1.0
        for (nm, pos), i in idx.items():
            out[f'{nm}|{pos}|{Y}'] = dict(z=round(float(w[i] / sd), 2), games=appear[(nm, pos)])
        print(f'  {Y}: 窗口内 {len(window)} 局，求解 {N} 人', file=sys.stderr)
    path = os.path.join(HERE, 'cache', 'macro_rapm.json')
    json.dump(out, open(path, 'w', encoding='utf-8'), ensure_ascii=False)

    def show(name):
        rows = [(era, out[k]) for k in out for nm, pos, era in [k.split('|')] if nm == name]
        best = {}
        for era, v in rows:                                  # 同一年打过两个位置：取场次多的
            if era not in best or v['games'] > best[era]['games']:
                best[era] = v
        print(f'  {name:10s} ' + ' '.join(f"{era[2:]}:{v['z']:+.1f}" for era, v in sorted(best.items())))

    print('\n逐年的运营值（单位：全体的标准差；>0 表示他在场时，队伍比 15 分钟局面预示的赢得更多）')
    for nm in ('Faker', 'Doinb', 'BeryL', 'Mata', 'Meiko', 'Score', 'Canyon', 'Chovy', 'Deft', 'Ruler', 'Caps', 'CoreJJ', 'Peanut', 'Xiaohu', 'Rookie', 'TheShy', 'Uzi', 'Bjergsen', 'Jankos', 'ShowMaker', 'Keria', 'Zeus'):
        show(nm)
    print('\n各年前 10：')
    for era in sorted({int(k.split('|')[2]) for k in out}):
        top = sorted(((v['z'], k.split('|')[0], k.split('|')[1]) for k, v in out.items() if int(k.split('|')[2]) == era), reverse=True)[:10]
        print(f'  {era}: ' + '  '.join(f'{n}({z:+.1f})' for z, n, p in top))
    by_pos = collections.defaultdict(list)
    for k, v in out.items():
        by_pos[k.split('|')[1]].append(v['z'])
    print('\n按位置的平均运营值：' + '  '.join(f'{p} {sum(v) / len(v):+.2f}' for p, v in by_pos.items()))


if __name__ == '__main__':
    main()
