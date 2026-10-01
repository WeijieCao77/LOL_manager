# -*- coding: utf-8 -*-
"""
每年的真实世界 -> src/data/history.json：历史入口开局之后，世界往哪儿长。

    PYTHONIOENCODING=utf-8 python scripts/lol/build_history.py

读 data-build/world_2016.json … world_2026.json（scripts/lol/build_world.py --year Y --history 建的，
每年只用开局之前的比赛评能力），整理出两样东西（策划稿第七节 3、决定 8）：

  people   每个在 2016–2026 任何一年出现在我们模拟的联赛里的人：ID、位置、生日、国籍、居民赛区，
           以及每一年他在哪支队（OE 的队名——OE 把老队名改成今天的组织名，正好是跨年认队的钥匙）、
           能力多少。引擎据此做「真实新人按出道年份入场」：第 Y 年进入世界、而开局到 Y−1 年
           都不在世界里的人，在 Y 年开季进入自由人池，水平取他 Y+1 年的能力（那是用 Y 年的比赛评出来的，
           即他当时的真实水平），潜力取他之后各年的最高能力。
  rosters  每年每支队的真实名单（OE 队名 -> 人），给「历史引力」：AI 引援偏向真实历史里这一年
           就在这支队的人。只在 ≤ 2026 的年份生效。

人和队用 OE 的写法认（ID + 位置；OE 队名），和世界文件里的 hkey / oeName 一一对应。
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
YEARS = list(range(2016, 2027))


def main():
    worlds = {}
    for y in YEARS:
        path = os.path.join(REPO, 'data-build', f'world_{y}.json')
        if not os.path.exists(path):
            sys.exit(f'缺 {path}：先跑 build_world.py --year {y} --history')
        worlds[y] = json.load(open(path, encoding='utf-8'))

    people, rosters = {}, {}
    for y, w in worlds.items():
        teams = {t['id']: t for t in w['teams']}
        rosters[str(y)] = {}
        for p in w['players']:
            key = p.get('hkey') or f"{p['ign']}|?"
            t = teams.get(p.get('teamId'))
            row = people.setdefault(key, dict(
                ign=p['ign'], role=p['role'], birth=p.get('birth'), nat=p.get('nat'),
                res=p.get('residency'), real=p.get('realName'), years={},
            ))
            # the most recent record wins for the identity fields
            for k, v in (('birth', p.get('birth')), ('nat', p.get('nat')), ('res', p.get('residency')), ('real', p.get('realName'))):
                if v:
                    row[k] = v
            # [club (OE name) or null for a free agent, overall, tier]
            row['years'][str(y)] = [t.get('oeName') or t['name'] if t else None, p['overall'], t['tier'] if t else 0]
            if t:
                rosters[str(y)].setdefault(t.get('oeName') or t['name'], []).append(key)

    out = dict(
        meta=dict(built='scripts/lol/build_history.py', years=YEARS,
                  note='每年的世界只用开局之前的比赛评能力；队名是 OE 的写法（老队名已换成今天的组织名，用来跨年认队）'),
        people=people, rosters=rosters,
    )
    dst = os.path.join(REPO, 'src', 'data', 'history.json')
    json.dump(out, open(dst, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    # what a 2016 and a 2022 career will see arrive
    for start in (2016, 2022):
        line = []
        for y in range(start + 1, 2027):
            new = [k for k, r in people.items()
                   if str(y) in r['years'] and r['years'][str(y)][0]
                   and not any(str(x) in r['years'] for x in range(start, y))]
            line.append(f'{y}:{len(new)}')
        print(f'{start} 档每年进入世界的真人：' + ' '.join(line), file=sys.stderr)
    star = [k for k in ('Chovy|mid', 'Knight|mid', 'Viper|bot', 'Ruler|bot', 'Canyon|jng', 'Zeus|top') if k in people]
    for k in star:
        r = people[k]
        print(f"  {k:12s} " + ' '.join(f"{y}:{v[0] or '自由人'}({v[1]})" for y, v in sorted(r['years'].items())), file=sys.stderr)
    print(f'-> {dst}  {os.path.getsize(dst) // 1024} KB  {len(people)} 人', file=sys.stderr)


if __name__ == '__main__':
    main()
