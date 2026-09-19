#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
选手照片和缺的队标 -> public/faces/、public/logos/，并登记到 src/data/dossier.json。

    PYTHONIOENCODING=utf-8 python scripts/lol/fetch_media.py            （在 export_engine.py、build_crests.py 之后跑）
    PYTHONIOENCODING=utf-8 python scripts/lol/fetch_media.py --dry      只对人，不下载

来源是 Riot 电竞接口的战队表（破晓项目里现成的 data/raw/teams_en.json）：每支队的标识、
每名选手的官方定妆照，都是 static.lolesports.com 上的静态地址。作者 2026-09-19 同意批量下载。
限速、UA、磁盘缓存、robots 都在 fetchlib.py 里。

认人的规则——宁可没有照片，也不把别人的脸安在他头上：
  同一个 ID 在 Riot 的表里常常不止一个人（全球 1,500 多支队）。先看队伍对不对得上，
  再看位置；还分不出来就不放。只有一个候选人时，位置也得一致（表里有位置的话）。
Riot 给没有定妆照的人放的是一张剪影，那张不算照片。
"""
from __future__ import annotations

import argparse, hashlib, io, json, os, re, sys, unicodedata
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetchlib import Session, ROOT  # noqa: E402

SRC = Path(os.environ.get('LOL_DATA_DIR') or ROOT.parent / 'lol选手' / 'data') / 'raw' / 'teams_en.json'
FACES = ROOT / 'public' / 'faces'
LOGOS = ROOT / 'public' / 'logos'
FACE_PX, LOGO_PX = 160, 96
ROLE = {'top': '上单', 'jungle': '打野', 'mid': '中单', 'bottom': '下路', 'support': '辅助'}
PLACEHOLDER = re.compile(r'default|silhouette|placeholder|blank', re.I)


def norm(s: str) -> str:
    # Leviatán / Leviatan、LØS / LOS：两边的写法只差重音
    s = unicodedata.normalize('NFKD', (s or '').replace('Ø', 'O').replace('ø', 'o'))
    return re.sub(r'[^a-z0-9]', '', s.lower())


def https(url: str) -> str:
    return re.sub(r'^http://', 'https://', url)


def webp(raw: bytes, px: int, square: bool) -> bytes:
    im = Image.open(io.BytesIO(raw)).convert('RGBA')
    if square:
        # 定妆照是半身竖图，脸在上面三分之一：取顶部的正方形
        w, h = im.size
        side = min(w, h)
        left = (w - side) // 2
        im = im.crop((left, 0, left + side, side))
    im.thumbnail((px, px), Image.LANCZOS)
    if square:
        bg = Image.new('RGBA', im.size, (24, 26, 32, 255))
        bg.alpha_composite(im)
        im = bg.convert('RGB')
    buf = io.BytesIO()
    im.save(buf, 'WEBP', quality=82 if square else 90, method=6)
    return buf.getvalue()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry', action='store_true')
    args = ap.parse_args()

    world = json.load(open(ROOT / 'src' / 'data' / 'world.json', encoding='utf-8'))
    prospects = json.load(open(ROOT / 'src' / 'data' / 'prospects.json', encoding='utf-8'))['players']
    riot = json.load(open(SRC, encoding='utf-8'))['data']['teams']
    dpath = ROOT / 'src' / 'data' / 'dossier.json'
    dossier = json.load(open(dpath, encoding='utf-8'))

    # ---- Riot 的表：ID -> 候选人
    by_ign: dict[str, list[dict]] = {}
    team_img: dict[str, str] = {}
    for t in riot:
        if t.get('image') and not PLACEHOLDER.search(t['image']):
            for key in (norm(t['name']), norm(t.get('slug', ''))):
                if key:
                    team_img.setdefault(key, t['image'])
        for p in t.get('players') or []:
            img = p.get('image') or ''
            if not img or PLACEHOLDER.search(img):
                continue
            by_ign.setdefault(norm(p['summonerName']), []).append(
                dict(team=norm(t['name']), code=norm(t.get('code', '')), role=ROLE.get(p.get('role')), img=img))

    teams = {t['id']: t for t in world['teams']}
    want = []
    for p in world['players']:
        t = teams.get(p.get('teamId'))
        want.append(dict(id=p['id'], ign=p['ign'], role=p['role'], team=norm(t['name']) if t else '', code=norm(t['tag']) if t else ''))
    for r in prospects:
        want.append(dict(id=r['id'], ign=r['ign'], role=r.get('pos'), team=norm(r.get('club') or ''), code=''))

    picked: dict[str, str] = {}
    why = dict(team=0, role=0, only=0, ambiguous=0, none=0)
    for w in want:
        cands = by_ign.get(norm(w['ign']), [])
        # 同一个人在一队和二队各有一条是常事：地址相同的算一个
        if not cands:
            why['none'] += 1
            continue
        same_team = [c for c in cands if w['team'] and (c['team'] == w['team'] or (w['code'] and c['code'] == w['code']))]
        same_role = [c for c in cands if c['role'] and c['role'] == w['role']]
        pool, how = (same_team, 'team') if same_team else (same_role, 'role')
        if how == 'team' and len({c['img'] for c in pool}) > 1:
            pool = [c for c in pool if c['role'] == w['role']] or pool
        urls = list(dict.fromkeys(c['img'] for c in pool))
        if len(urls) == 1:
            if how == 'role' and len({c['img'] for c in cands}) == 1:
                how = 'only'
            picked[w['id']] = urls[0]
            why[how] += 1
        else:
            why['ambiguous' if cands else 'none'] += 1

    missing_logo = [t for t in world['teams'] if t['id'] not in (dossier.get('logos') or {})]
    logo_url = {}
    for t in missing_logo:
        u = team_img.get(norm(t['name']))
        if u:
            logo_url[t['id']] = u

    print(f"选手 {len(want)}：按队伍认出 {why['team']}，按位置认出 {why['role']}，唯一同名 {why['only']}；"
          f"分不清不放 {why['ambiguous']}，Riot 表里没有 {why['none']}")
    print(f"缺队标的俱乐部 {len(missing_logo)}，Riot 表里找到 {len(logo_url)}")
    if args.dry:
        return 0

    s = Session('static.lolesports.com', min_interval=0.4)
    FACES.mkdir(parents=True, exist_ok=True)
    LOGOS.mkdir(parents=True, exist_ok=True)
    players = dossier.setdefault('players', {})
    ok = bad = 0
    for i, (pid, url) in enumerate(picked.items()):
        try:
            data = webp(s.image(https(url)), FACE_PX, square=True)
        except Exception as e:                              # 一张坏图不该断掉七百张
            bad += 1
            print(f'  跳过 {pid}: {e}', file=sys.stderr)
            continue
        (FACES / f'{pid}.webp').write_bytes(data)
        players.setdefault(pid, {}).update(img=f'{pid}.webp', v=hashlib.sha1(data).hexdigest()[:8])
        ok += 1
        if (i + 1) % 100 == 0:
            print(f'  照片 {i + 1} / {len(picked)}', file=sys.stderr)
    logos = dossier.setdefault('logos', {})
    lok = 0
    for tid, url in logo_url.items():
        try:
            data = webp(s.image(https(url)), LOGO_PX, square=False)
        except Exception as e:
            print(f'  跳过队标 {tid}: {e}', file=sys.stderr)
            continue
        (LOGOS / f'{tid}.webp').write_bytes(data)
        logos[tid] = hashlib.sha1(data).hexdigest()[:8]
        lok += 1

    # 二队和一队是同一家俱乐部、同一个队标（Dplus Kia Challengers 用的就是 Dplus Kia 的）。
    # 只认这一种关系：去掉 Challengers / Academy / Youth 之后和本赛区某支一级队同名，
    # 或者第一个词相同且只有一支（Nongshim Esports Academy -> Nongshim RedForce）。
    shared = 0
    for t in world['teams']:
        if t['id'] in logos or t['tier'] == 1:
            continue
        stem = re.sub(r'\s+(Challengers|Academy|Youth)$', '', t['name'])
        if stem == t['name']:
            continue
        firsts = [x for x in world['teams'] if x['tier'] == 1 and x['region'] == t['region'] and x['id'] in logos]
        parent = ([x for x in firsts if norm(x['name']) == norm(stem)]
                  or [x for x in firsts if norm(x['name'].split()[0]) == norm(stem.split()[0])])
        if len(parent) == 1:
            data = (LOGOS / f"{parent[0]['id']}.webp").read_bytes()
            (LOGOS / f"{t['id']}.webp").write_bytes(data)
            logos[t['id']] = hashlib.sha1(data).hexdigest()[:8]
            shared += 1
    print(f'二队沿用一队队标 {shared}')

    meta = dossier.setdefault('meta', {})
    meta['photos'] = sum(1 for v in players.values() if v.get('img'))
    meta.setdefault('sources', {})['选手照片'] = 'Riot 电竞接口战队表里的官方定妆照（static.lolesports.com）'
    meta['sources']['队标'] = '破晓项目 data/logos + Riot 电竞接口战队表（小尺寸标识用途）'
    json.dump(dossier, open(dpath, 'w', encoding='utf-8'), ensure_ascii=False)
    tier1 = [t for t in world['teams'] if t['tier'] == 1]
    print(f'照片 {ok}（失败 {bad}）；新队标 {lok}；队标合计 {len(logos)} / {len(world["teams"])}'
          f'（一级联赛 {sum(1 for t in tier1 if t["id"] in logos)} / {len(tier1)}）')
    still = [f"{t['tag']}({t['league']})" for t in world['teams'] if t['id'] not in logos]
    if still:
        print('仍然没有队标：' + '、'.join(still))
    print(s.report())
    return 0


if __name__ == '__main__':
    sys.exit(main())
