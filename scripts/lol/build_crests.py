# -*- coding: utf-8 -*-
"""
队标：破晓项目里已有的队标 -> public/logos/<俱乐部 id>.webp，并登记到 dossier.json。

    PYTHONIOENCODING=utf-8 python scripts/lol/build_crests.py      （在 export_engine.py 之后跑）

来源是同一位作者「破晓」项目的 data/logos/（Riot 电竞接口的战队表，小尺寸标识用途），
本脚本只读本地文件，不联网。按队名对；对不上的俱乐部没有队标，界面上显示简称——不拿别的队的图顶。
俱乐部 id 是世界文件按顺序编的，重建世界之后要重跑这个脚本。
"""
import hashlib, io, json, os, re, sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
SRC = os.environ.get('LOL_LOGO_DIR') or os.path.join(os.path.dirname(REPO), 'lol选手', 'data', 'logos')
if not os.path.isdir(SRC):
    SRC = os.path.join(REPO, '_ref', 'LOL_breaker', 'data', 'logos')
DST = os.path.join(REPO, 'public', 'logos')
SIZE = 96


def norm(s):
    return re.sub(r'[^a-z0-9]', '', s.lower())


def main():
    world = json.load(open(os.path.join(REPO, 'src', 'data', 'world.json'), encoding='utf-8'))
    files = {norm(os.path.splitext(f)[0]): f for f in os.listdir(SRC) if f.lower().endswith('.png')}
    os.makedirs(DST, exist_ok=True)
    for f in os.listdir(DST):
        os.remove(os.path.join(DST, f))
    logos, missing = {}, []
    for t in world['teams']:
        f = files.get(norm(t['name']))
        if not f:
            missing.append(f"{t['tag']}({t['league']})")
            continue
        im = Image.open(os.path.join(SRC, f)).convert('RGBA')
        im.thumbnail((SIZE, SIZE), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, 'WEBP', quality=90, method=6)
        data = buf.getvalue()
        open(os.path.join(DST, f"{t['id']}.webp"), 'wb').write(data)
        logos[t['id']] = hashlib.sha1(data).hexdigest()[:8]
    dpath = os.path.join(REPO, 'src', 'data', 'dossier.json')
    dossier = json.load(open(dpath, encoding='utf-8'))
    dossier['logos'] = logos
    dossier.setdefault('meta', {}).setdefault('sources', {})['队标'] = '破晓项目 data/logos（Riot 电竞接口战队表，小尺寸标识用途）'
    json.dump(dossier, open(dpath, 'w', encoding='utf-8'), ensure_ascii=False)
    tier1 = [t for t in world['teams'] if t['tier'] == 1]
    print(f"队标 {len(logos)} / {len(world['teams'])}（一级联赛 {sum(1 for t in tier1 if t['id'] in logos)} / {len(tier1)}）", file=sys.stderr)
    if missing:
        print('没有队标：' + '、'.join(missing), file=sys.stderr)


if __name__ == '__main__':
    main()
