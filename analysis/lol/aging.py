# -*- coding: utf-8 -*-
"""
年龄曲线：同一个人相邻两年的变化，按年龄归档。

    PYTHONIOENCODING=utf-8 python analysis/lol/aging.py        （先跑 extract_major.py）

用「同一个人 t 年到 t+1 年的 z 变化」而不是「各年龄的平均水平」，因为后者全是幸存者偏差：
能打到 28 岁的人本来就是最强的那批，直接按年龄取平均会得出「越老越强」。
这个方法自己也有偏差，要心里有数：
  · 回归均值。某年数据特别好的人下一年多半回落，所以每个年龄的变化都略偏负；
    看的是各项之间、各年龄之间的相对形状，不是绝对值。
  · 能被观察到下一年的，是没被淘汰的人。真实的衰退比这里量到的略陡。
输出同时写到 analysis/lol/cache/aging.json，引擎的年龄曲线按它标定。
"""
import collections, csv, json, os
from study_lib import load, aggregate, zscores, mean

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
DATA = os.environ.get('LOL_DATA_DIR') or os.path.join(os.path.dirname(REPO), 'lol选手', 'data')
ROLE = {'Top': 'top', 'Jungle': 'jng', 'Mid': 'mid', 'Bot': 'bot', 'Support': 'sup'}
# 每项能力用哪些原料看年龄变化
GROUPS = {
    '对线': ['gd15', 'cd15', 'xd15'], '操作': ['dpm', 'dshare', 'kda'], '团战': ['kp', 'dshare'],
    '发育': ['cspm', 'egpm'], '意识': ['vspm', 'dths', 'fb'], '协同': ['kp', 'dths'],
}


def main():
    d = load()
    T = aggregate(d['players'])
    Z = zscores(T)
    bio = collections.defaultdict(list)
    for r in csv.DictReader(open(os.path.join(DATA, 'csv', 'players_master.csv'), encoding='utf-8-sig')):
        if r['birthdate']:
            bio[(r['player_id'].lower(), ROLE.get(r['role']))].append(int(r['birthdate'][:4]))
    delta = collections.defaultdict(lambda: collections.defaultdict(list))
    people = set()
    for k in Z:
        name, pos, y, line = k
        k2 = (name, pos, y + 1, line)
        if line == 'INTL' or T[k]['n'] < 25 or k2 not in Z or T[k2]['n'] < 25:
            continue
        b = bio.get((name.lower(), pos), [])
        if len(b) != 1:
            continue                                   # 同名多人分不清的不用
        age = y + 1 - b[0]
        people.add(name)
        for g, feats in GROUPS.items():
            vals = [Z[k2][f] - Z[k][f] for f in feats if f in Z[k] and f in Z[k2]]
            if vals:
                delta[age][g].append(sum(vals) / len(vals))
    print(f'有生日、相邻两年都打满 25 场的选手 {len(people)} 人\n')
    print('年龄   对数 | ' + '  '.join(f'{g:>5s}' for g in GROUPS) + '    （同位置同联赛内的标准差 / 年）')
    out = {}
    for age in sorted(delta):
        n = len(delta[age]['操作'])
        if n < 10:
            continue
        row = {g: round(mean(delta[age][g]) or 0.0, 3) for g in GROUPS}
        out[age] = dict(n=n, **row)
        print(f' {age:2d}   {n:4d} | ' + '  '.join(f'{row[g]:+6.2f}' for g in GROUPS))
    json.dump(out, open(os.path.join(HERE, 'cache', 'aging.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('\n各项从哪一年开始持续为负（连续两年 <= -0.05）：')
    for g in GROUPS:
        ages = sorted(out)
        start = next((a for a, b in zip(ages, ages[1:]) if out[a][g] <= -.05 and out[b][g] <= -.05), None)
        total = sum(out[a][g] for a in ages if start and a >= start and a <= 28)
        print(f'  {g}：{start} 岁起，到 28 岁累计 {total:+.2f}')


if __name__ == '__main__':
    main()
