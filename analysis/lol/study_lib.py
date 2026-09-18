# -*- coding: utf-8 -*-
"""数值研究的公共部分：读缓存、按（选手, 年, 赛区线）聚合、同位置同联赛同年内标准化。"""
import collections, math, os, pickle

HERE = os.path.dirname(os.path.abspath(__file__))
POS = ('top', 'jng', 'mid', 'bot', 'sup')
FEATS = ('gd15', 'cd15', 'xd15', 'dpm', 'dshare', 'kda', 'multi', 'cspm', 'egpm', 'gshare',
         'kp', 'dths', 'vspm', 'wcpm', 'fb', 'wr')
# 哪个方向是「好」：阵亡占比越低越好
SIGN = collections.defaultdict(lambda: 1, dths=-1)


def load():
    return pickle.load(open(os.path.join(HERE, 'cache', 'major.pkl'), 'rb'))


def mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def aggregate(players, key=lambda r: (r['playername'], r['position'], r['year'], r['line'])):
    agg = collections.defaultdict(lambda: collections.defaultdict(list))
    for r in players:
        if r['position'] not in POS or not r['playername']:
            continue
        a = agg[key(r)]
        a['n'].append(1)
        a['win'].append(1.0 if r['win'] else 0.0)
        for src, dst in (('golddiffat15', 'gd15'), ('csdiffat15', 'cd15'), ('xpdiffat15', 'xd15'), ('dpm', 'dpm'),
                         ('damageshare', 'dshare'), ('cspm', 'cspm'), ('earned gpm', 'egpm'),
                         ('earnedgoldshare', 'gshare'), ('vspm', 'vspm'), ('wcpm', 'wcpm')):
            if r[src] is not None:
                a[dst].append(r[src])
        for k in ('kills', 'deaths', 'assists', 'teamkills', 'teamdeaths'):
            a[k].append(r[k] or 0.0)
        a['multi'].append(sum(r[m] or 0.0 for m in ('doublekills', 'triplekills', 'quadrakills', 'pentakills')))
        a['fb'].append((r['firstbloodkill'] or 0.0) + (r['firstbloodassist'] or 0.0))
        a['teams'].append(r['teamname'])
    out = {}
    for k, a in agg.items():
        n = len(a['n'])
        K, D, A, TK, TD = (sum(a[x]) for x in ('kills', 'deaths', 'assists', 'teamkills', 'teamdeaths'))
        out[k] = dict(
            n=n, wr=mean(a['win']), gd15=mean(a['gd15']), cd15=mean(a['cd15']), xd15=mean(a['xd15']),
            dpm=mean(a['dpm']), dshare=mean(a['dshare']), cspm=mean(a['cspm']), egpm=mean(a['egpm']),
            gshare=mean(a['gshare']), vspm=mean(a['vspm']), wcpm=mean(a['wcpm']),
            kda=math.log((K + A + 1) / (D + 1)), multi=mean(a['multi']), fb=mean(a['fb']),
            kp=(K + A) / TK if TK else None, dths=D / TD if TD else None,
            team=collections.Counter(a['teams']).most_common(1)[0][0],
        )
    return out


def zscores(table, group=lambda k: (k[1], k[2], k[3]), min_n=15):
    """同组（默认：位置 × 年 × 赛区线）内标准化。返回 {key: {feat: z}}，方向已统一成「越大越好」。"""
    groups = collections.defaultdict(list)
    for k, f in table.items():
        if f['n'] >= min_n:
            groups[group(k)].append(k)
    z = {}
    for g, keys in groups.items():
        for feat in FEATS:
            vals = [table[k][feat] for k in keys if table[k][feat] is not None]
            if len(vals) < 5:
                continue
            mu = sum(vals) / len(vals)
            sd = (sum((v - mu) ** 2 for v in vals) / len(vals)) ** .5 or 1.0
            for k in keys:
                if table[k][feat] is not None:
                    z.setdefault(k, {})[feat] = SIGN[feat] * (table[k][feat] - mu) / sd
    return z
