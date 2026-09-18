# -*- coding: utf-8 -*-
"""
管线产物 -> 引擎读的格式。

    PYTHONIOENCODING=utf-8 python scripts/lol/export_engine.py

    data-build/world_2026.json  ->  src/data/world.json
    data-build/champions.json   ->  src/data/champions.json

为什么要多这一步：管线的字段按英雄联盟的说法起名（champPool、isCaptain、games），引擎是从
VAL MANAGER 复刻来的，很多内部字段还叫 agentPool / isIgl / rounds。在引擎内部全部改名之前，
差异集中在这一个文件里对上，两边各自保持干净。这里只做改名和换算，不做任何评分。
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
# 引擎里「熟练」的门槛是按回合数定的（一张图约 20 个回合）；一局英雄联盟按 20 个回合折算
ROUNDS_PER_GAME = 20


def main():
    world = json.load(open(os.path.join(REPO, 'data-build', 'world_2026.json'), encoding='utf-8'))
    champs = json.load(open(os.path.join(REPO, 'data-build', 'champions.json'), encoding='utf-8'))
    known = {c['id'] for c in champs['champions']}

    players = []
    for p in world['players']:
        use = {c: n * ROUNDS_PER_GAME for c, n in p.get('champUse', {}).items() if c in known}
        players.append(dict(
            id=p['id'], ign=p['ign'], teamId=p['teamId'], region=p['region'],
            nat=p.get('nat'), residency=p.get('residency'), realName=p.get('realName'), birth=p.get('birth'),
            age=p['age'], ageEstimated=p.get('ageEstimated', False),
            role=p['role'], roles=p['roles'], flex=False,
            # 队长：开局时每队运营最高的首发。引擎里这个标记还叫 isIgl
            isIgl=bool(p.get('isCaptain')), iglSource='inferred' if p.get('isCaptain') else None,
            rounds=p.get('games', 0) * ROUNDS_PER_GAME,
            attrs=p['attrs'], overall=p['overall'], potential=p['potential'],
            form=p['form'], morale=p['morale'], fatigue=p['fatigue'],
            salary=p['salary'], value=p['value'], contractYears=p['contractYears'],
            loyalty=p['loyalty'], ambition=p['ambition'],
            agentPool=[c for c in p.get('champPool', []) if c in known],
            agentUse=use,
            # 引擎拿它微调没练满的英雄：1.0 是平均。由胜率折算，五成胜率 = 1.0
            agentR={c: round(1 + (wr - .5) * .6, 2) for c, wr in p.get('champWr', {}).items() if c in known},
            macroFrom=p.get('macroFrom'), oe=p.get('oe'),
        ))
        players[-1] = {k: v for k, v in players[-1].items() if v is not None}

    meta = dict(world['meta'])
    meta['analysts'] = []                      # OE 里没有分析师；不编
    out = dict(meta=meta, teams=world['teams'], players=players)
    dst = os.path.join(REPO, 'src', 'data', 'world.json')
    json.dump(out, open(dst, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(f'-> {dst}  {os.path.getsize(dst) // 1024} KB  {len(out["teams"])} 队 {len(players)} 人')

    cdst = os.path.join(REPO, 'src', 'data', 'champions.json')
    year = str(meta['season'])
    slim = [dict(id=c['id'], cn=c['cn'], positions=c['positions'], since=c['since'],
                 lean=c['lean'], fight=c['fight'], meta=c['meta'].get(year))
            for c in champs['champions']]
    json.dump(dict(season=meta['season'], champions=slim), open(cdst, 'w', encoding='utf-8'),
              ensure_ascii=False, separators=(',', ':'))
    print(f'-> {cdst}  {os.path.getsize(cdst) // 1024} KB  {len(slim)} 个英雄')


if __name__ == '__main__':
    main()
