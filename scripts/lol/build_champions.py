# -*- coding: utf-8 -*-
"""
英雄表：Oracle's Elixir 2015–2026 全部职业比赛 -> champions.json

    PYTHONIOENCODING=utf-8 python scripts/lol/build_champions.py

表里的每一样都是从比赛里读出来的，只有中文译名是对照表（CN）：
  positions   这个英雄在职业赛场上打什么位置（最近三年，出场占比 >= 12% 的都算——
              一个英雄可以有多个位置，王者荣耀经理吃过「只记最后一条路」的亏）
  since       第一次出现在职业比赛里的日期。历史入口开档时，还没上线的英雄不进 BP
  meta[year]  那一年的选用率、禁用率、胜率 -> 各入口的版本开局强度
  lean        打法倾向，-1（前期滚雪球）到 +1（运营后期）：赢的局比输的局长多少、
              15 分钟经济差多少。三类阵容体系按它归类，不手写
  fight       团战倾向：参团率与伤害占比相对同位置的偏移

只用英雄的名字，不用任何官方图片（策划稿第十节：Riot 的素材政策）。
"""
import collections, csv, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
DATA = os.environ.get('LOL_DATA_DIR') or os.path.join(os.path.dirname(REPO), 'lol选手', 'data')
POS = ('top', 'jng', 'mid', 'bot', 'sup')
ROLE_CN = {'top': '上单', 'jng': '打野', 'mid': '中单', 'bot': '下路', 'sup': '辅助'}
YEARS = range(2015, 2027)
RECENT = (2024, 2025, 2026)
# 选用率只在大赛区里算：小联赛的版本理解滞后，会把过气英雄的数字抬高
MAJOR = {'LPL', 'LCK', 'LEC', 'LCS', 'EU LCS', 'NA LCS', 'LTA N', 'LTA', 'MSI', 'WLDs', 'FST'}

CN = {
    'Aatrox': '亚托克斯', 'Ahri': '阿狸', 'Akali': '阿卡丽', 'Akshan': '阿克尚', 'Alistar': '阿利斯塔', 'Ambessa': '安蓓萨',
    'Amumu': '阿木木', 'Anivia': '艾尼维亚', 'Annie': '安妮', 'Aphelios': '厄斐琉斯', 'Ashe': '艾希', 'Aurelion Sol': '奥瑞利安·索尔',
    'Aurora': '阿萝拉', 'Azir': '阿兹尔', 'Bard': '巴德', "Bel'Veth": '卑尔维斯', 'Blitzcrank': '布里茨', 'Brand': '布兰德',
    'Braum': '布隆', 'Briar': '贝蕾亚', 'Caitlyn': '凯特琳', 'Camille': '卡蜜尔', 'Cassiopeia': '卡西奥佩娅', "Cho'Gath": '科加斯',
    'Corki': '库奇', 'Darius': '德莱厄斯', 'Diana': '黛安娜', 'Dr. Mundo': '蒙多医生', 'Draven': '德莱文', 'Ekko': '艾克',
    'Elise': '伊莉丝', 'Evelynn': '伊芙琳', 'Ezreal': '伊泽瑞尔', 'Fiddlesticks': '费德提克', 'Fiora': '菲奥娜', 'Fizz': '菲兹',
    'Galio': '加里奥', 'Gangplank': '普朗克', 'Garen': '盖伦', 'Gnar': '纳尔', 'Gragas': '古拉加斯', 'Graves': '格雷福斯',
    'Gwen': '格温', 'Hecarim': '赫卡里姆', 'Heimerdinger': '黑默丁格', 'Hwei': '彗', 'Illaoi': '俄洛伊', 'Irelia': '艾瑞莉娅',
    'Ivern': '艾翁', 'Janna': '迦娜', 'Jarvan IV': '嘉文四世', 'Jax': '贾克斯', 'Jayce': '杰斯', 'Jhin': '烬', 'Jinx': '金克丝',
    "K'Sante": '奎桑提', "Kai'Sa": '卡莎', 'Kalista': '卡莉丝塔', 'Karma': '卡尔玛', 'Karthus': '卡尔萨斯', 'Kassadin': '卡萨丁',
    'Katarina': '卡特琳娜', 'Kayle': '凯尔', 'Kayn': '凯隐', 'Kennen': '凯南', "Kha'Zix": '卡兹克', 'Kindred': '千珏',
    'Kled': '克烈', "Kog'Maw": '克格莫', 'LeBlanc': '乐芙兰', 'Lee Sin': '李青', 'Leona': '蕾欧娜', 'Lillia': '莉莉娅',
    'Lissandra': '丽桑卓', 'Lucian': '卢锡安', 'Lulu': '璐璐', 'Lux': '拉克丝', 'Malphite': '墨菲特', 'Malzahar': '玛尔扎哈',
    'Maokai': '茂凯', 'Master Yi': '易', 'Mel': '梅尔', 'Milio': '米利欧', 'Miss Fortune': '厄运小姐', 'Mordekaiser': '莫德凯撒',
    'Morgana': '莫甘娜', 'Naafiri': '纳亚菲利', 'Nami': '娜美', 'Nasus': '内瑟斯', 'Nautilus': '诺提勒斯', 'Neeko': '妮蔻',
    'Nidalee': '奈德丽', 'Nilah': '尼菈', 'Nocturne': '魔腾', 'Nunu & Willump': '努努和威朗普', 'Olaf': '奥拉夫', 'Orianna': '奥莉安娜',
    'Ornn': '奥恩', 'Pantheon': '潘森', 'Poppy': '波比', 'Pyke': '派克', 'Qiyana': '奇亚娜', 'Quinn': '奎因', 'Rakan': '洛',
    'Rammus': '拉莫斯', "Rek'Sai": '雷克塞', 'Rell': '芮尔', 'Renata Glasc': '烈娜塔 · 戈拉斯克', 'Renekton': '雷克顿', 'Rengar': '雷恩加尔',
    'Riven': '锐雯', 'Rumble': '兰博', 'Ryze': '瑞兹', 'Samira': '莎弥拉', 'Sejuani': '瑟庄妮', 'Senna': '赛娜', 'Seraphine': '萨勒芬妮',
    'Sett': '瑟提', 'Shaco': '萨科', 'Shen': '慎', 'Shyvana': '希瓦娜', 'Singed': '辛吉德', 'Sion': '赛恩', 'Sivir': '希维尔',
    'Skarner': '斯卡纳', 'Smolder': '斯莫德', 'Sona': '娑娜', 'Soraka': '索拉卡', 'Swain': '斯维因', 'Sylas': '塞拉斯', 'Syndra': '辛德拉',
    'Tahm Kench': '塔姆', 'Taliyah': '塔莉垭', 'Talon': '泰隆', 'Taric': '塔里克', 'Teemo': '提莫', 'Thresh': '锤石', 'Tristana': '崔丝塔娜',
    'Trundle': '特朗德尔', 'Tryndamere': '泰达米尔', 'Twisted Fate': '崔斯特', 'Twitch': '图奇', 'Udyr': '乌迪尔', 'Urgot': '厄加特',
    'Varus': '韦鲁斯', 'Vayne': '薇恩', 'Veigar': '维迦', "Vel'Koz": '维克兹', 'Vex': '薇古丝', 'Vi': '蔚', 'Viego': '佛耶戈',
    'Viktor': '维克托', 'Vladimir': '弗拉基米尔', 'Volibear': '沃利贝尔', 'Warwick': '沃里克', 'Wukong': '孙悟空', 'Xayah': '霞',
    'Xerath': '泽拉斯', 'Xin Zhao': '赵信', 'Yasuo': '亚索', 'Yone': '永恩', 'Yorick': '约里克', 'Yunara': '芸阿娜', 'Yuumi': '悠米',
    'Zac': '扎克', 'Zed': '劫', 'Zeri': '泽丽', 'Ziggs': '吉格斯', 'Zilean': '基兰', 'Zoe': '佐伊', 'Zyra': '婕拉',
    'Zaahen': '亚恒', 'Locke': '洛克',
    # 全表已对过 Riot Data Dragon 16.18.1 的 zh_CN 英雄表（173 个逐个相同）。以后的新英雄同样去那里查，查不到就留空，界面退到英文名
}


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def main():
    since = {}
    pos_recent = collections.defaultdict(collections.Counter)
    yearly = collections.defaultdict(lambda: collections.defaultdict(lambda: dict(p=0, w=0, b=0)))
    games_major = collections.Counter()
    # 打法倾向的原料：最近三年，全部联赛
    glen_w, glen_l = collections.defaultdict(list), collections.defaultdict(list)
    gd15 = collections.defaultdict(list)
    kp = collections.defaultdict(list)
    pos_kp = collections.defaultdict(list)

    for y in YEARS:
        path = os.path.join(DATA, 'oracleselixir', f'{y}_OE.csv')
        if not os.path.exists(path):
            print(f'  ! 没有 {y}', file=sys.stderr)
            continue
        n = 0
        with open(path, encoding='utf-8', errors='replace') as fh:
            for r in csv.DictReader(fh):
                major = r['league'] in MAJOR
                if r['position'] == 'team':
                    if major:
                        games_major[y] += 1                       # 每局两行队伍行
                        for k in ('ban1', 'ban2', 'ban3', 'ban4', 'ban5'):
                            if r.get(k):
                                yearly[y][r[k]]['b'] += 1
                    continue
                c = r.get('champion')
                if not c or r['position'] not in POS:
                    continue
                n += 1
                day = r['date'][:10]
                if c not in since or day < since[c]:
                    since[c] = day
                win = r['result'] == '1'
                if major:
                    yearly[y][c]['p'] += 1
                    yearly[y][c]['w'] += win
                if y in RECENT:
                    pos_recent[c][r['position']] += 1
                    gl = num(r.get('gamelength'))
                    if gl:
                        (glen_w if win else glen_l)[c].append(gl / 60)
                    g = num(r.get('golddiffat15'))
                    if g is not None:
                        gd15[c].append(g)
                    tk = num(r.get('teamkills'))
                    if tk:
                        v = ((num(r.get('kills')) or 0) + (num(r.get('assists')) or 0)) / tk
                        kp[c].append((r['position'], v))
                        pos_kp[r['position']].append(v)
        print(f'  {y}: {n} 行', file=sys.stderr)

    avg = lambda xs: sum(xs) / len(xs) if xs else 0.0
    pos_kp_mean = {p: avg(v) for p, v in pos_kp.items()}
    out = []
    unknown = []
    for c in sorted(since):
        total = sum(pos_recent[c].values())
        if total:
            positions = [p for p, n in pos_recent[c].most_common() if n / total >= .12]
        else:
            positions = []                                          # 近三年没人选过：位置留空，BP 里不会出现
        # 打法倾向：赢的局比输的局长 -> 后期；15 分钟领先 -> 前期
        n_lean = min(len(glen_w[c]), len(glen_l[c]))
        late = (avg(glen_w[c]) - avg(glen_l[c])) if n_lean >= 30 else 0.0          # 分钟
        early = avg(gd15[c]) / 400 if len(gd15[c]) >= 60 else 0.0                   # 400 金 ≈ 一个单位
        lean = max(-1.0, min(1.0, late / 2.0 - early * .6))
        fight = avg([v - pos_kp_mean[p] for p, v in kp[c]]) * 10 if len(kp[c]) >= 60 else 0.0
        meta = {}
        for y in YEARS:
            d = yearly[y].get(c)
            g = games_major[y] / 2
            if d and g and (d['p'] or d['b']):
                meta[str(y)] = dict(pick=round(d['p'] / g, 3), ban=round(d['b'] / g, 3),
                                    win=round(d['w'] / d['p'], 3) if d['p'] >= 20 else None)
        if c not in CN:
            unknown.append(c)
        out.append(dict(id=c, cn=CN.get(c), positions=[ROLE_CN[p] for p in positions], since=since[c],
                        lean=round(lean, 2), fight=round(max(-1, min(1, fight)), 2),
                        sample=total, meta=meta))

    path = os.path.join(REPO, 'data-build', 'champions.json')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump(dict(meta=dict(source="Oracle's Elixir 2015–2026", recent=list(RECENT), major=sorted(MAJOR)),
                   champions=out), open(path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

    print(f'\n-> {path}  {os.path.getsize(path) // 1024} KB，{len(out)} 个英雄', file=sys.stderr)
    by_year = collections.Counter(c['since'][:4] for c in out)
    print('首次出场年份：' + '  '.join(f'{y}:{n}' for y, n in sorted(by_year.items())), file=sys.stderr)
    print('多位置英雄：' + '  '.join(f"{c['cn'] or c['id']}({'/'.join(c['positions'])})" for c in out if len(c['positions']) >= 2)[:900], file=sys.stderr)
    m = sorted((c for c in out if '2026' in c['meta']), key=lambda c: -(c['meta']['2026']['pick'] + c['meta']['2026']['ban']))
    print('2026 选禁率最高：' + '  '.join(f"{c['cn']}({c['meta']['2026']['pick'] + c['meta']['2026']['ban']:.0%})" for c in m[:14]), file=sys.stderr)
    ranked = sorted((c for c in out if c['sample'] >= 300), key=lambda c: c['lean'])
    print('最偏前期：' + '  '.join(f"{c['cn']}({c['lean']:+.2f})" for c in ranked[:10]), file=sys.stderr)
    print('最偏后期：' + '  '.join(f"{c['cn']}({c['lean']:+.2f})" for c in ranked[-10:]), file=sys.stderr)
    print(f'近三年无人选用（位置留空）：{sum(1 for c in out if not c["positions"])} 个', file=sys.stderr)
    if unknown:
        print('没有中文译名的：' + '、'.join(unknown), file=sys.stderr)


if __name__ == '__main__':
    main()
