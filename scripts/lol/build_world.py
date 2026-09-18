# -*- coding: utf-8 -*-
"""
英雄联盟世界数据：Oracle's Elixir 逐场数据 -> world_<year>.json

    PYTHONIOENCODING=utf-8 python scripts/lol/build_world.py --year 2026
    PYTHONIOENCODING=utf-8 python scripts/lol/build_world.py --year 2022 --history

数据不在本仓库里。默认读同一位作者「破晓」项目的数据目录（桌面/lol选手/data），
也可以用环境变量 LOL_DATA_DIR 指过去。用到的三样：
    oracleselixir/<year>_OE.csv   逐场比赛数据（每局 12 行：10 名选手 + 2 行队伍）
    csv/players_master.csv        Leaguepedia 选手表：中文名、真名、国籍、居民赛区、生日
    raw/teams_en.json             Riot 电竞接口的战队表：队标简称

立项前提：没有一个虚构的人。查不到的字段留空，不编。

八项能力怎么来
--------------
没有任何地方公布一个叫「意识」的数字。公布的是视野得分、阵亡占比、一血参与——
所以每项能力是一组相关统计的加权，并且**全程在「同位置 × 同联赛」里标准化**：
辅助的分均补刀永远比下路低，拿原始数字比，说的不是谁更强，说的是他打什么位置。

两道闸门挡住把噪声读成能力：
  · 按场次收缩  z *= n / (n + SHRINK_K)。替补顶上打二十场数据可能很好看，那不是他的水平。
  · 联赛基准    标准化只说他在同行里的位置，不说这个联赛值多少。绝对水平由
                LEAGUE_BASE 定：一级赛区之间用国际赛交手记录拟合（Bradley-Terry），
                二级联赛按母赛区下调。

「运营」是怎么来的（docs/调研-选手数值与年龄曲线.md）
----------------------------------------------------
这一项说的是「这个人在场上，队伍 15 分钟之后多赢多少」，不说他是不是喊话的那个人。
英雄联盟的决策是分散的（前期节奏在打野、视野在辅助、边线在中上），固定五人组里谁在指挥，
比赛数据原理上分不出来，本作也不去指定——没有「指挥」这个身份，只有每个人身上的这个数。
个人能力随年龄掉，这一项掉得慢得多：2023 年 Faker 个人数据全线为负，他缺阵的 18 场 T1 胜率 22%，
他在场 69%。它由三样合成，每一样都是算出来的，没有一样是手填的：
    40%  运营 RAPM     每局「实际胜负 − 15 分钟局面预示的胜率」对场上十人做岭回归（三年窗口，国际赛 ×3）
    20%  队伍运营残差  他所在的队的同一个量：和队友分不开的那部分，全队共享
    40%  资历          此前打过的场次（大赛区 1、其他 0.3、国际赛 3），取平方根，在进入这个世界的选手内部标准化。
                       RAPM 在固定队友之间分不开，同队的人之间主要靠这一项区分

哪些是量出来的、哪些是推出来的，写在输出的 meta.derived 里。
"""
import argparse, collections, csv, json, math, os, random, re, sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
DATA = os.environ.get('LOL_DATA_DIR') or os.path.join(os.path.dirname(REPO), 'lol选手', 'data')

POS = ('top', 'jng', 'mid', 'bot', 'sup')
ROLE_CN = {'top': '上单', 'jng': '打野', 'mid': '中单', 'bot': '下路', 'sup': '辅助'}
ATTRS = ('laning', 'mechanics', 'teamfight', 'farming', 'awareness', 'clutch', 'teamwork', 'macro')

# 总评的位置权重。engine/player.ts 的 ROLE_WEIGHT 必须和这里逐项一致，
# 输出的 meta.roleWeight 就是给核验脚本对账用的。
ROLE_WEIGHT = {
    'top': dict(laning=.24, mechanics=.20, teamfight=.16, farming=.12, awareness=.10, clutch=.08, teamwork=.07, macro=.03),
    'jng': dict(laning=.10, mechanics=.16, teamfight=.18, farming=.08, awareness=.22, clutch=.08, teamwork=.12, macro=.06),
    'mid': dict(laning=.20, mechanics=.24, teamfight=.16, farming=.12, awareness=.10, clutch=.09, teamwork=.06, macro=.03),
    'bot': dict(laning=.16, mechanics=.26, teamfight=.18, farming=.18, awareness=.06, clutch=.09, teamwork=.05, macro=.02),
    'sup': dict(laning=.12, mechanics=.08, teamfight=.16, farming=.06, awareness=.24, clutch=.06, teamwork=.20, macro=.08),
}

# ---------------------------------------------------------------- 世界里有哪些联赛
# (联赛代码, 赛区键, 层级, 显示名)。赛区键就是一级联赛的名字。
WORLD_LEAGUES = {
    2026: [
        ('LPL', 'LPL', 1, 'LPL'), ('LCK', 'LCK', 1, 'LCK'), ('LEC', 'LEC', 1, 'LEC'),
        ('LCS', 'LCS', 1, 'LCS'), ('LCP', 'LCP', 1, 'LCP'), ('CBLOL', 'CBLOL', 1, 'CBLOL'),
        # 二级：没有升级，人会被一级队挖走。LDL 2026 年没有办（docs/调研-外援名额与居民规则.md 第五节）
        ('LCKC', 'LCK', 2, 'LCK CL'), ('NACL', 'LCS', 2, 'NACL'), ('LFL', 'LEC', 2, 'LFL'),
        ('PCS', 'LCP', 2, 'PCS'), ('CD', 'CBLOL', 2, 'Circuito Desafiante'),
    ],
}

# 往年的联赛代码归到今天的哪条线上、相对那条线差多少（只用于给往年的数据定绝对水平）
LINEAGE = {
    'LTA N': ('LCS', 0), 'LTA S': ('CBLOL', 0), 'LLA': ('CBLOL', -3),
    'VCS': ('LCP', -3), 'LJL': ('LCP', -8), 'LCO': ('LCP', -9),
    'LDL': ('LPL', -11), 'LVP SL': ('LEC', -11), 'PRM': ('LEC', -11), 'TCL': ('LEC', -11),
    'NLC': ('LEC', -13), 'EM': ('LEC', -9), 'EUM': ('LEC', -9),
}
TIER2_DROP = {'LCKC': -13, 'NACL': -12, 'LFL': -10, 'PCS': -6, 'CD': -9}
TIER2_MAX = 10         # 二级联赛最多收几支队：OE 的同一个联赛代码下常混着更低一级的队

INTERNATIONAL = {'MSI', 'WLDs', 'FST', 'EWC'}

MAJOR_LINES = {'LPL', 'LCK', 'LEC', 'EU LCS', 'LCS', 'NA LCS', 'LTA N'}
RAPM_WINDOW = {0: 1.0, 1: .7, 2: .45}   # 距开局年几年 -> 权重
RAPM_INTL_W = 3.0
RAPM_LAMBDA = 45.0
RAPM_MIN_GAMES = 40
MACRO_MIX = dict(rapm=.40, team=.20, exp=.40)

SHRINK_K = 25          # 场次收缩
SPREAD = 7.5           # 一个标准差值多少点
TOP_BASE = 79.0        # 最强赛区首发的平均水平
BT_SCALE = 9.0         # 赛区强度（对数几率）差 1.0 值多少点
BT_FLOOR = -1.45       # 交手样本太少的赛区不往下无限掉

# OE 队名 -> 通用简称。Riot 战队表里的正式名常和 OE 对不上（JD Gaming / JDG Intel Esports Club），
# 对不上的从这里取；再没有才退到首字母。沿用破晓 data/fetch_logos.py 的表，补了 2026 年的队。
TAG_ALIAS = {
    'JD Gaming': 'JDG', 'Top Esports': 'TES', 'EDward Gaming': 'EDG', 'Weibo Gaming': 'WBG', 'LNG Esports': 'LNG',
    'Bilibili Gaming': 'BLG', 'Invictus Gaming': 'IG', 'FunPlus Phoenix': 'FPX', 'Team WE': 'WE', 'Oh My God': 'OMG',
    'LGD Gaming': 'LGD', 'Ultra Prime': 'UP', 'ThunderTalk Gaming': 'TT', "Anyone's Legend": 'AL',
    'Ninjas in Pyjamas': 'NIP', 'Royal Never Give Up': 'RNG', 'Rare Atom': 'RA',
    'Gen.G': 'GEN', 'T1': 'T1', 'Dplus KIA': 'DK', 'Dplus Kia': 'DK', 'DRX': 'DRX', 'KT Rolster': 'KT',
    'Hanwha Life Esports': 'HLE', 'Nongshim RedForce': 'NS', 'HANJIN BRION': 'BRO', 'OKSavingsBank BRION': 'BRO',
    'BNK FEARX': 'BFX', 'DN SOOPers': 'DNS', 'DN Freecs': 'DNF',
    'G2 Esports': 'G2', 'Fnatic': 'FNC', 'Team Vitality': 'VIT', 'SK Gaming': 'SK', 'Karmine Corp': 'KC',
    'Movistar KOI': 'MKOI', 'Team Heretics': 'TH', 'GiantX': 'GX', 'Natus Vincere': 'NAVI', 'Shifters': 'SHFT',
    'Team BDS': 'BDS', 'Rogue': 'RGE',
    'Cloud9': 'C9', 'Team Liquid': 'TL', '100 Thieves': '100', 'FlyQuest': 'FLY', 'Dignitas': 'DIG',
    'Shopify Rebellion': 'SR', 'Disguised': 'DSG', 'LYON': 'LYON', 'Sentinels': 'SEN',
    'CTBC Flying Oyster': 'CFO', 'GAM Esports': 'GAM', 'Team Secret Whales': 'TSW', 'DetonatioN FocusMe': 'DFM',
    'Fukuoka SoftBank HAWKS gaming': 'SHG', 'MVK Esports': 'MVK', 'Deep Cross Gaming': 'DCG', 'Ground Zero Gaming': 'GZ',
    'paiN Gaming': 'PNG', 'LOUD': 'LLL', 'FURIA': 'FUR', 'RED Canids': 'RED', 'Vivo Keyd Stars': 'VKS',
    'Fluxo W7M': 'FXW7', 'Leviatan': 'LEV', 'Leviatán': 'LEV', 'Isurus Estral': 'ISG',
}

COUNTRY_ISO = {
    'China': 'cn', 'South Korea': 'kr', 'Taiwan': 'tw', 'Hong Kong': 'hk', 'Macau': 'mo', 'Vietnam': 'vn',
    'Japan': 'jp', 'United States': 'us', 'Canada': 'ca', 'Brazil': 'br', 'Argentina': 'ar', 'Chile': 'cl',
    'Mexico': 'mx', 'Peru': 'pe', 'Colombia': 'co', 'Uruguay': 'uy', 'Denmark': 'dk', 'Sweden': 'se',
    'Norway': 'no', 'Finland': 'fi', 'Germany': 'de', 'France': 'fr', 'Spain': 'es', 'Poland': 'pl',
    'Czech Republic': 'cz', 'Slovenia': 'si', 'Croatia': 'hr', 'Greece': 'gr', 'Turkey': 'tr', 'Belgium': 'be',
    'Netherlands': 'nl', 'United Kingdom': 'gb', 'Ireland': 'ie', 'Italy': 'it', 'Portugal': 'pt',
    'Romania': 'ro', 'Bulgaria': 'bg', 'Hungary': 'hu', 'Serbia': 'rs', 'Slovakia': 'sk', 'Austria': 'at',
    'Switzerland': 'ch', 'Lithuania': 'lt', 'Latvia': 'lv', 'Estonia': 'ee', 'Ukraine': 'ua', 'Russia': 'ru',
    'Australia': 'au', 'New Zealand': 'nz', 'Philippines': 'ph', 'Thailand': 'th', 'Malaysia': 'my',
    'Singapore': 'sg', 'Indonesia': 'id', 'Morocco': 'ma', 'Egypt': 'eg', 'Israel': 'il', 'Armenia': 'am',
    'Kazakhstan': 'kz', 'Bosnia and Herzegovina': 'ba', 'North Macedonia': 'mk', 'Iceland': 'is',
    'Dominican Republic': 'do', 'Venezuela': 've', 'Ecuador': 'ec', 'Costa Rica': 'cr', 'Paraguay': 'py',
}
# Leaguepedia 的居民赛区 -> 本作的赛区键（外援名额按这个判）
RESIDENCY_KEY = {
    'China': 'LPL', 'Korea': 'LCK', 'EMEA': 'LEC', 'Europe': 'LEC', 'Turkey': 'LEC', 'CIS': 'LEC', 'MENA': 'LEC',
    'North America': 'LCS', 'Brazil': 'CBLOL', 'Latin America': 'CBLOL',
    'Asia Pacific': 'LCP', 'PCS': 'LCP', 'Vietnam': 'LCP', 'Japan': 'LCP', 'Oceania': 'LCP', 'Southeast Asia': 'LCP',
}


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def norm_name(s):
    s = (s or '').lower()
    s = re.sub(r'\b(esports?|e-sports|gaming|club|team|the)\b', '', s)
    return re.sub(r'[^a-z0-9]', '', s)


# ================================================================ 读 OE
def read_year(year, wanted):
    """一年的选手行与队伍行，只留 wanted 里的联赛。"""
    path = os.path.join(DATA, 'oracleselixir', f'{year}_OE.csv')
    if not os.path.exists(path):
        print(f'  ! 没有 {path}', file=sys.stderr)
        return [], []
    players, teams = [], []
    with open(path, encoding='utf-8', errors='replace') as fh:
        for row in csv.DictReader(fh):
            if row['league'] not in wanted:
                continue
            (teams if row['position'] == 'team' else players).append(row)
    return players, teams


def league_strength(years):
    """一级赛区之间的强弱：国际赛里跨赛区的每一局，Bradley-Terry 拟合到对数几率上。"""
    games = collections.defaultdict(dict)
    home = collections.defaultdict(collections.Counter)
    for y in years:
        path = os.path.join(DATA, 'oracleselixir', f'{y}_OE.csv')
        if not os.path.exists(path):
            continue
        with open(path, encoding='utf-8', errors='replace') as fh:
            for row in csv.DictReader(fh):
                if row['position'] != 'team':
                    continue
                if row['league'] in INTERNATIONAL:
                    games[(y, row['gameid'])][row['side']] = (row['teamname'], row['result'] == '1')
                else:
                    home[(y, row['teamname'])][row['league']] += 1
    wins = collections.defaultdict(lambda: collections.Counter())
    for (y, _), sides in games.items():
        if len(sides) != 2:
            continue
        (ta, wa), (tb, _) = sides.values()
        la = home[(y, ta)].most_common(1)[0][0] if home[(y, ta)] else None
        lb = home[(y, tb)].most_common(1)[0][0] if home[(y, tb)] else None
        la, lb = LINEAGE.get(la, (la, 0))[0], LINEAGE.get(lb, (lb, 0))[0]
        if not la or not lb or la == lb:
            continue
        wins[la if wa else lb][lb if wa else la] += 1
    leagues = sorted(set(wins) | {l for w in wins.values() for l in w})
    s = {l: 1.0 for l in leagues}
    for _ in range(200):                                   # MM 迭代；每个赛区垫一场虚拟平局防止发散
        nxt = {}
        for a in leagues:
            w = sum(wins[a].values()) + 0.5
            d = sum((wins[a][b] + wins[b][a] + (1.0 if b != a else 0) / len(leagues)) / (s[a] + s[b]) for b in leagues if b != a)
            nxt[a] = w / d if d else s[a]
        g = math.exp(sum(math.log(v) for v in nxt.values()) / len(nxt))
        s = {k: v / g for k, v in nxt.items()}
    top = max(s.values())
    n_games = {l: sum(wins[l].values()) + sum(wins[o][l] for o in leagues) for l in leagues}
    return {l: max(BT_FLOOR, math.log(v / top)) for l, v in s.items()}, n_games


# ================================================================ 特征
def new_rec():
    return dict(n=0, wins=0, k=0.0, d=0.0, a=0.0, tk=0.0, td=0.0, multi=0.0, fb=0.0,
                dpm=[], dshare=[], cspm=[], egpm=[], gshare=[], vspm=[], wcpm=[],
                gd15=[], xd15=[], cd15=[], behind_n=0, behind_w=0, behind_kda=[], normal_kda=[],
                decisive=[], regular=[], champs=collections.Counter(), champ_w=collections.Counter(),
                teams=collections.Counter(), first=None, last=None)


def aggregate(players, teams):
    ctx = {(t['gameid'], t['side']): num(t.get('golddiffat15')) for t in teams}
    agg = collections.defaultdict(new_rec)
    for r in players:
        pos, nm = r['position'], (r.get('playername') or '').strip()
        if pos not in POS or not nm:
            continue
        a = agg[(nm, pos, r['league'])]
        win = r['result'] == '1'
        a['n'] += 1
        a['wins'] += win
        k, d, s = num(r.get('kills')) or 0, num(r.get('deaths')) or 0, num(r.get('assists')) or 0
        tk, td = num(r.get('teamkills')) or 0, num(r.get('teamdeaths')) or 0
        a['k'] += k; a['d'] += d; a['a'] += s; a['tk'] += tk; a['td'] += td
        a['fb'] += (num(r.get('firstbloodkill')) or 0) + (num(r.get('firstbloodassist')) or 0)
        for m in ('doublekills', 'triplekills', 'quadrakills', 'pentakills'):
            a['multi'] += num(r.get(m)) or 0
        for key, col in (('dpm', 'dpm'), ('dshare', 'damageshare'), ('cspm', 'cspm'), ('egpm', 'earned gpm'),
                         ('gshare', 'earnedgoldshare'), ('vspm', 'vspm'), ('wcpm', 'wcpm'),
                         ('gd15', 'golddiffat15'), ('xd15', 'xpdiffat15'), ('cd15', 'csdiffat15')):
            v = num(r.get(col))
            if v is not None:
                a[key].append(v)
        kda = (k + s) / max(1.0, d)
        g15 = ctx.get((r['gameid'], r['side']))
        if g15 is not None:
            if g15 <= -1500:
                a['behind_n'] += 1; a['behind_w'] += win; a['behind_kda'].append(kda)
            else:
                a['normal_kda'].append(kda)
        (a['decisive'] if (num(r.get('game')) or 0) >= 3 else a['regular']).append(kda)
        if r.get('champion'):
            a['champs'][r['champion']] += 1
            a['champ_w'][r['champion']] += win
        a['teams'][r['teamname']] += 1
        day = r['date'][:10]
        a['first'] = min(a['first'] or day, day)
        a['last'] = max(a['last'] or day, day)
    return agg


def features(a):
    n = a['n']
    lane = mean([mean(a['gd15']), None]) if a['gd15'] else None
    return dict(
        gd15=mean(a['gd15']), xd15=mean(a['xd15']), cd15=mean(a['cd15']),
        dpm=mean(a['dpm']), dshare=mean(a['dshare']), cspm=mean(a['cspm']), egpm=mean(a['egpm']),
        gshare=mean(a['gshare']), vspm=mean(a['vspm']), wcpm=mean(a['wcpm']),
        kda=math.log((a['k'] + a['a'] + 1) / (a['d'] + 1)), multi=a['multi'] / n, fb=a['fb'] / n,
        kp=(a['k'] + a['a']) / a['tk'] if a['tk'] else None,
        ashare=a['a'] / a['tk'] if a['tk'] else None,
        apm=a['a'] / n,
        dths=a['d'] / a['td'] if a['td'] else None,
        wr=a['wins'] / n,
        comeback=(a['behind_w'] / a['behind_n']) if a['behind_n'] >= 3 else None,
        hold=(mean(a['behind_kda']) / max(.3, mean(a['normal_kda']))) if a['behind_kda'] and a['normal_kda'] else None,
        decisive=((mean(a['decisive']) - mean(a['regular'])) / max(.3, mean(a['regular']))) if a['decisive'] and a['regular'] else None,
        _lane=lane,
    )


# 每项能力由哪些特征合成。辅助的「发育」看视野不看补刀；没有 15 分钟数据时「对线」退到分均经济。
RECIPE = {
    'laning':    dict(default=[('gd15', .45), ('cd15', .30), ('xd15', .25)], sup=[('gd15', .5), ('xd15', .5)],
                      fallback=[('egpm', .6), ('cspm', .4)]),
    'mechanics': dict(default=[('dpm', .35), ('dshare', .25), ('kda', .25), ('multi', .15)],
                      sup=[('kda', .5), ('kp', .3), ('dpm', .2)]),
    'teamfight': dict(default=[('kp', .40), ('dths', -.25), ('dshare', .20), ('apm', .15)]),
    'farming':   dict(default=[('cspm', .45), ('egpm', .35), ('gshare', .20)], sup=[('vspm', .6), ('egpm', .4)]),
    'awareness': dict(default=[('vspm', .35), ('dths', -.30), ('wcpm', .20), ('fb', .15)],
                      fallback=[('dths', -.6), ('fb', .4)]),
    'clutch':    dict(default=[('comeback', .42), ('hold', .32), ('decisive', .26)]),
    'teamwork':  dict(default=[('kp', .45), ('ashare', .35), ('dths', -.20)]),
}


def macro_value(rows_by_year, Y, history):
    """运营 RAPM 与队伍运营残差。rows_by_year[y] = (players, teams)。
    历史入口不看开局年当年的比赛（不偷看未来）。返回 ({(名字,位置): z}, {队名: z}, 说明)。"""
    games = collections.defaultdict(lambda: dict(Blue=[], Red=[], win=None, year=None, intl=False, gd=None))
    for y, (players, teams) in rows_by_year.items():
        if history and y >= Y:
            continue
        for t in teams:
            if t['side'] == 'Blue':
                g = games[t['gameid']]
                g['gd'] = num(t.get('golddiffat15')); g['win'] = 1.0 if t['result'] == '1' else 0.0
                g['year'] = y; g['intl'] = t['league'] in INTERNATIONAL; g['blue_team'] = t['teamname']
            else:
                games[t['gameid']]['red_team'] = t['teamname']
        for r in players:
            if r['position'] in POS and (r.get('playername') or '').strip():
                games[r['gameid']][r['side']].append(((r['playername'] or '').strip(), r['position']))
    valid = [g for g in games.values() if len(g['Blue']) == 5 and len(g['Red']) == 5 and g['win'] is not None]
    # 逐年的 P(赢 | 15 分钟经济差)
    slope = {}
    for y in {g['year'] for g in valid}:
        xs = np.array([g['gd'] / 1000 for g in valid if g['year'] == y and g['gd'] is not None])
        ys = np.array([g['win'] for g in valid if g['year'] == y and g['gd'] is not None])
        b = 0.5
        for _ in range(60):
            pr = 1 / (1 + np.exp(-b * xs))
            b -= np.mean((pr - ys) * xs) / (np.mean(pr * (1 - pr) * xs * xs) or 1.0)
        slope[y] = b if len(xs) > 200 else 0.55
    appear = collections.Counter(k for g in valid for side in ('Blue', 'Red') for k in g[side])
    keys = sorted(k for k, n in appear.items() if n >= RAPM_MIN_GAMES)
    idx = {k: i for i, k in enumerate(keys)}
    N = len(keys)
    XtX = np.zeros((N, N)); Xty = np.zeros(N)
    team_acc = collections.defaultdict(lambda: [0.0, 0.0])
    no_gd = 0
    last = max((g['year'] for g in valid), default=Y)
    for g in valid:
        wt = RAPM_WINDOW.get(last - g['year'], 0) * (RAPM_INTL_W if g['intl'] else 1.0)
        if not wt:
            continue
        if g['gd'] is None:
            # 没有 15 分钟数据（2022–2025 的 LPL）：退到「实际胜负 − 五成」，权重减半。
            # 这样的残差里混着对线的功劳，所以只给一半的话语权。
            y_res, wt = g['win'] - .5, wt * .5
            no_gd += 1
        else:
            y_res = g['win'] - 1 / (1 + math.exp(-slope[g['year']] * g['gd'] / 1000))
        cols = [(idx[k], sg) for side, sg in (('Blue', 1.0), ('Red', -1.0)) for k in g[side] if k in idx]
        for i, si in cols:
            Xty[i] += wt * si * y_res
            for j, sj in cols:
                XtX[i, j] += wt * si * sj
        if not g['intl'] and g['year'] == last:
            team_acc[g['blue_team']][0] += y_res; team_acc[g['blue_team']][1] += 1
            team_acc[g['red_team']][0] -= y_res; team_acc[g['red_team']][1] += 1
    w = np.linalg.solve(XtX + RAPM_LAMBDA * np.eye(N), Xty) if N else np.zeros(0)
    sd = float(w.std()) or 1.0
    rapm = {k: float(w[i] / sd) for k, i in idx.items()}
    tv = {t: a / n for t, (a, n) in team_acc.items() if n >= 20}
    mu = sum(tv.values()) / len(tv) if tv else 0.0
    tsd = (sum((v - mu) ** 2 for v in tv.values()) / len(tv)) ** .5 if tv else 1.0
    team = {t: (v - mu) / (tsd or 1.0) for t, v in tv.items()}
    return rapm, team, dict(games=len(valid), players=N, withoutGd15=no_gd)


def experience(Y):
    """开局年之前每个人打过多少场：大赛区 1、其他 0.3、国际赛 3。返回 {(名字,位置): 加权场次}。"""
    exp = collections.Counter()
    for y in range(2015, Y):
        path = os.path.join(DATA, 'oracleselixir', f'{y}_OE.csv')
        if not os.path.exists(path):
            continue
        with open(path, encoding='utf-8', errors='replace') as fh:
            rd = csv.reader(fh)
            head = next(rd)
            i_lg, i_pos, i_nm = head.index('league'), head.index('position'), head.index('playername')
            for row in rd:
                if row[i_pos] in POS and row[i_nm]:
                    lg = row[i_lg]
                    exp[(row[i_nm].strip(), row[i_pos])] += 3.0 if lg in INTERNATIONAL else 1.0 if lg in MAJOR_LINES else .3
    return exp


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--year', type=int, default=2026)
    ap.add_argument('--history', action='store_true', help='历史入口：能力只用开局年之前的比赛评，不偷看未来')
    ap.add_argument('--out', default=None)
    args = ap.parse_args()
    Y = args.year
    if Y not in WORLD_LEAGUES:
        sys.exit(f'还没有 {Y} 年的联赛表（WORLD_LEAGUES）')
    out_path = args.out or os.path.join(REPO, 'data-build', f'world_{Y}.json')
    world_leagues = WORLD_LEAGUES[Y]
    codes = {c for c, *_ in world_leagues}
    wanted = codes | set(LINEAGE) | INTERNATIONAL

    # 哪几年的数据进评分、各占多少。默认世界用到当年；历史入口只用之前两年，新人缺数据才看当年（多收缩）。
    year_w = {Y - 2: .35, Y - 1: .65, Y: .25} if args.history else {Y - 2: .2, Y - 1: .3, Y: .5}
    print(f'世界 {Y}；评分年份权重 {year_w}；数据目录 {DATA}', file=sys.stderr)

    # ---- 赛区强度 -> 联赛基准
    bt, bt_n = league_strength(sorted(year_w))
    base = {}
    for code, region, tier, _ in world_leagues:
        if tier == 1:
            base[code] = TOP_BASE + BT_SCALE * bt.get(code, BT_FLOOR)
    for code, region, tier, _ in world_leagues:
        if tier == 2:
            base[code] = base[region] + TIER2_DROP.get(code, -11)
    for old, (line, off) in LINEAGE.items():
        if line in base and old not in base:
            base[old] = base[line] + off
    print('联赛基准：' + '  '.join(f'{k} {v:.1f}' for k, v in sorted(base.items(), key=lambda x: -x[1]) if k in codes), file=sys.stderr)

    # ---- 逐年聚合、组内标准化
    recs = []                       # (name, pos, league, year, n, z{feat}, agg)
    year_rows = {}
    rows_by_year = {}
    for y in sorted(year_w):
        players, teams = read_year(y, wanted)
        rows_by_year[y] = (players, teams)
        if y == Y:
            year_rows = dict(players=players, teams=teams)
        agg = aggregate(players, teams)
        groups = collections.defaultdict(list)
        for (nm, pos, lg), a in agg.items():
            if lg in base and a['n'] >= 3:
                groups[(pos, lg)].append((nm, a, features(a)))
        for (pos, lg), members in groups.items():
            stats = {}
            for feat in members[0][2]:
                vals = [f[feat] for _, a, f in members if f[feat] is not None and a['n'] >= 10]
                if len(vals) >= 4:
                    mu = sum(vals) / len(vals)
                    sd = (sum((v - mu) ** 2 for v in vals) / len(vals)) ** .5 or 1.0
                    stats[feat] = (mu, sd)
            for nm, a, f in members:
                z = {feat: max(-3.0, min(3.0, (f[feat] - mu) / sd)) for feat, (mu, sd) in stats.items() if f[feat] is not None}
                recs.append(dict(name=nm, pos=pos, league=lg, year=y, n=a['n'], z=z, agg=a))
        print(f'  {y}: 选手行 {len(players)}，有效 (选手,位置,联赛) 记录 {sum(len(m) for m in groups.values())}', file=sys.stderr)

    # ---- 运营的三样原料
    rapm, team_macro, rapm_info = macro_value(rows_by_year, Y, args.history)
    exp_raw = experience(Y)
    e_mu = e_sd = None        # 在下面拿到「这个世界里有谁」之后再定尺子
    print(f'运营 RAPM：{rapm_info["games"]} 局（其中 {rapm_info["withoutGd15"]} 局没有 15 分钟数据，半权），求解 {rapm_info["players"]} 人；'
          f'资历表 {len(exp_raw)} 人', file=sys.stderr)

    # ---- 选手 = 名字 + 位置。合并各年各联赛的记录
    by_player = collections.defaultdict(list)
    for r in recs:
        by_player[(r['name'], r['pos'])].append(r)

    derived_lane, derived_aware = set(), set()
    macro_parts = {}
    # 两把尺子都只拿「最近一年在一级联赛打球的人」来量。拿全部一万四千人量，或者把二级联赛的人
    # 混进来量，一线选手人人都是 +3 个标准差，顶尖的几个人之间就分不出高下了。
    # 二级联赛的人用同一把尺子，自然落在负值区。
    tier1_codes = {c for c, _, t, _ in world_leagues if t == 1}
    def in_tier1(rows):
        latest = max(rows, key=lambda r: (r['year'], r['n']))
        return latest['league'] in tier1_codes and sum(r['n'] for r in rows) >= 25
    ruler = [k for k, rows in by_player.items() if in_tier1(rows)]
    # 平方根而不是对数：国际赛打过四百场和打过八十场不是一回事，取对数会把这个差距压没
    ev = [math.sqrt(exp_raw.get(k, 0.0)) for k in ruler]
    e_mu = sum(ev) / len(ev); e_sd = (sum((v - e_mu) ** 2 for v in ev) / len(ev)) ** .5 or 1.0
    rv = [rapm[k] for k in ruler if k in rapm]
    r_mu = sum(rv) / len(rv); r_sd = (sum((v - r_mu) ** 2 for v in rv) / len(rv)) ** .5 or 1.0

    def rate(name, pos):
        rows = by_player.get((name, pos))
        if not rows:
            return None
        out, eff_total = {}, 0.0
        weights = [(r, year_w[r['year']] * r['n']) for r in rows]
        eff = sum(w for _, w in weights) / max(year_w.values())        # 折成「相当于当年多少场」
        shrink = eff / (eff + SHRINK_K)
        if args.history and all(r['year'] == Y for r in rows):
            shrink *= .6                                               # 只有当年数据的新人：更保守
        level = sum(base[r['league']] * w for r, w in weights) / sum(w for _, w in weights)
        for attr, recipe in RECIPE.items():
            acc = wsum = 0.0
            for r, w in weights:
                spec = recipe.get(pos if pos == 'sup' else 'default') or recipe['default']
                if not any(k in r['z'] for k, _ in spec) and 'fallback' in recipe:
                    spec = recipe['fallback']
                    (derived_lane if attr == 'laning' else derived_aware).add(name)
                have = [(k, c) for k, c in spec if k in r['z']]
                if not have:
                    continue
                z = sum(r['z'][k] * c for k, c in have) / sum(abs(c) for _, c in have)
                acc += z * w; wsum += w
            z = (acc / wsum) if wsum else 0.0
            out[attr] = level + SPREAD * z * shrink * 1.35       # 合成会把方差压小，1.35 把它补回来
        # 运营：运营 RAPM + 队伍运营残差 + 资历（见文件头）。队伍取他最近一年出场最多的那支
        latest = max(rows, key=lambda r: (r['year'], r['n']))
        my_team = latest['agg']['teams'].most_common(1)[0][0]
        ex_z = (math.sqrt(exp_raw.get((name, pos), 0.0)) - e_mu) / e_sd
        ra_z = (rapm[(name, pos)] - r_mu) / r_sd if (name, pos) in rapm else 0.0
        macro_z = MACRO_MIX['rapm'] * ra_z + MACRO_MIX['team'] * team_macro.get(my_team, 0.0) + MACRO_MIX['exp'] * ex_z
        out['macro'] = 62 + 15.0 * macro_z + (level - 75) * .35
        macro_parts[(name, pos)] = (round(ra_z, 2), round(team_macro.get(my_team, 0.0), 2), round(ex_z, 2))
        eff_total = eff
        out['macro'] = max(35, min(97, out['macro']))
        return {k: int(round(max(30, min(99, v)))) for k, v in out.items()}, eff_total

    # ---- 名单：每支队开季窗口内每个位置出场最多的人
    opening = collections.defaultdict(lambda: collections.defaultdict(collections.Counter))
    splits_of = collections.defaultdict(set)
    season_start = {}
    for t in year_rows['teams']:
        if t['league'] in codes:
            splits_of[(t['league'], t['teamname'])].add(t['split'])
            season_start[t['league']] = min(season_start.get(t['league'], '9999'), t['date'][:10])

    def days(a, b):
        from datetime import date
        return (date.fromisoformat(b) - date.fromisoformat(a)).days

    for r in year_rows['players']:
        if r['league'] in codes and r['position'] in POS and days(season_start[r['league']], r['date'][:10]) <= 60:
            opening[(r['league'], r['teamname'])][r['position']][(r.get('playername') or '').strip()] += 1
    n_splits = {lg: len({s for (l, _), ss in splits_of.items() if l == lg for s in ss}) for lg in codes}
    # 客队：联赛有多个赛段，而这支队只在其中一个出现（2026 LEC 冬季赛的两支 ERL 客队）
    guests = {k for k, ss in splits_of.items() if n_splits[k[0]] >= 2 and len(ss) == 1 and k[0] in {c for c, _, t, _ in world_leagues if t == 1}}

    # ---- 选手档案表
    bio = collections.defaultdict(list)
    mpath = os.path.join(DATA, 'csv', 'players_master.csv')
    if os.path.exists(mpath):
        for row in csv.DictReader(open(mpath, encoding='utf-8-sig')):
            bio[row['player_id'].lower()].append(row)
    role_of = {'Top': 'top', 'Jungle': 'jng', 'Mid': 'mid', 'Bot': 'bot', 'Support': 'sup'}

    def find_bio(name, pos, team):
        cands = bio.get(name.lower(), [])
        if not cands:
            return None
        hit = [c for c in cands if norm_name(c.get('current_team')) == norm_name(team)]
        if len(hit) == 1:
            return hit[0]
        hit = [c for c in cands if role_of.get(c.get('role')) == pos and c.get('is_retired') != '1']
        if len(hit) == 1:
            return hit[0]
        return cands[0] if len(cands) == 1 else None          # 同名多人又分不清：留空，不猜

    tags = {}
    tpath = os.path.join(DATA, 'raw', 'teams_en.json')
    if os.path.exists(tpath):
        raw = json.load(open(tpath, encoding='utf-8'))
        for t in (raw.get('data', {}).get('teams') or []):
            if t.get('code') and t.get('status') == 'active':
                tags.setdefault(norm_name(t['name']), t['code'])

    # ---- 组装
    teams_out, players_out, used = [], [], set()
    no_bio, holes = [], []
    order = {c: i for i, (c, *_) in enumerate(world_leagues)}
    meta_of = {c: (region, tier, label) for c, region, tier, label in world_leagues}
    # 二级联赛：只收五个位置都凑得齐的队，再按全年场次取前 TIER2_MAX 支。
    # 残缺名单不进世界——宁可少一支队，也不拿别人补位。
    year_games = collections.Counter((t['league'], t['teamname']) for t in year_rows['teams'])
    skipped = []
    for code, _, tier, _ in world_leagues:
        if tier != 2:
            continue
        full = [k for k in opening if k[0] == code and all(
            any(rate(nm, pos) for nm, _ in opening[k][pos].most_common(2)) for pos in POS)]
        keep = set(sorted(full, key=lambda k: -year_games[k])[:TIER2_MAX])
        for k in [k for k in opening if k[0] == code and k not in keep]:
            skipped.append(f'{k[1]}({code})')
            guests.add(k)
    for (lg, tname) in sorted(opening, key=lambda k: (order[k[0]], k[1])):
        if (lg, tname) in guests:
            continue
        region, tier, label = meta_of[lg]
        tid = f'T{len(teams_out) + 1}'
        roster = []
        for pos in POS:
            ranked = opening[(lg, tname)][pos].most_common()
            if not ranked:
                holes.append(f'{tname} 缺 {ROLE_CN[pos]}')
            taken = 0
            for nm, g in ranked:                                 # 每个位置首发 + 至多一名替补；首选被占就顺延
                if taken >= 2:
                    break
                if any((nm, q) in used for q in POS) or (taken == 1 and g < 3):
                    continue
                rated = rate(nm, pos)
                if not rated:
                    continue
                taken += 1
                used.add((nm, pos))
                attrs, eff = rated
                b = find_bio(nm, pos, tname)
                if not b:
                    no_bio.append(f'{nm}({tname})')
                rng = random.Random(f'{Y}:{nm}:{pos}')
                overall = int(round(sum(attrs[k] * w for k, w in ROLE_WEIGHT[pos].items())))
                birth = (b or {}).get('birthdate') or None
                age = (Y - int(birth[:4])) if birth else None
                a = next(r['agg'] for r in by_player[(nm, pos)] if r['year'] == max(x['year'] for x in by_player[(nm, pos)]))
                champs = collections.Counter(); champ_w = collections.Counter()
                for r in by_player[(nm, pos)]:
                    champs.update(r['agg']['champs']); champ_w.update(r['agg']['champ_w'])
                pid = f'P{len(players_out) + 1}'
                est_age = age if age is not None else 21
                potential = min(99, overall + int(max(0, 24 - est_age) * 2.2 + rng.random() * 4))
                salary = int(round(33000 * math.exp((overall - 55) / 12) * (0.14 if tier == 2 else 1) * 2.5, -3))
                value = int(round(20000 * math.exp((overall - 55) / 10.5) * (1.25 if est_age <= 21 else 1.0 if est_age <= 25 else .7) * (0.2 if tier == 2 else 1) * 2.5, -3))
                players_out.append(dict(
                    id=pid, ign=nm, teamId=tid, region=region,
                    nat=COUNTRY_ISO.get((b or {}).get('country')),
                    residency=RESIDENCY_KEY.get((b or {}).get('residency')),
                    realName=((b or {}).get('name_cn') or (b or {}).get('real_name') or None),
                    birth=birth, age=est_age, ageEstimated=age is None,
                    role=ROLE_CN[pos], roles=[ROLE_CN[pos]], isCaptain=False,
                    games=int(round(eff)), attrs=attrs, overall=overall, potential=potential,
                    form=60 + rng.randrange(25), morale=65 + rng.randrange(25), fatigue=rng.randrange(6),
                    salary=salary, value=value, contractYears=1 + rng.randrange(3),
                    loyalty=35 + rng.randrange(50), ambition=35 + rng.randrange(55),
                    champPool=[c for c, _ in champs.most_common(6)],
                    champUse=dict(champs.most_common(30)),
                    champWr={c: round(champ_w[c] / n, 2) for c, n in champs.most_common(30) if n >= 5},
                    macroFrom=dict(zip(('rapm', 'team', 'exp'), macro_parts.get((nm, pos), (0, 0, 0)))),
                    oe=dict(games=a['n'], kda=round((a['k'] + a['a']) / max(1, a['d']), 2),
                            dpm=round(mean(a['dpm']) or 0), gd15=round(mean(a['gd15']) or 0) if a['gd15'] else None),
                ))
                roster.append(pid)
        if len({p['role'] for p in players_out if p['teamId'] == tid}) < 5:
            if tier == 2:                                        # 二级队凑不齐五个位置：不收，人放回去
                for p in [p for p in players_out if p['teamId'] == tid]:
                    used.discard((p['ign'], next(k for k, v in ROLE_CN.items() if v == p['role'])))
                players_out[:] = [p for p in players_out if p['teamId'] != tid]
                skipped.append(f'{tname}({lg})')
                continue
            holes.append(f'{tname} 只有 {len(roster)} 人')
        mine = [p for p in players_out if p['teamId'] == tid]
        starters = sorted(mine, key=lambda p: -p['overall'])[:5]
        rating = int(round(sum(p['overall'] for p in starters) / max(1, len(starters))))
        # 队长：开局时每队运营最高的首发。这只是游戏里的一个职务（经理可以改任），
        # 不是在说现实里谁是指挥——那件事数据分不出来，本作不去指定。
        if mine:
            first_five = [next(p for p in mine if p['role'] == ROLE_CN[q]) for q in POS]
            max(first_five, key=lambda p: p['attrs']['macro'])['isCaptain'] = True
        wage = sum(p['salary'] for p in mine)
        teams_out.append(dict(
            id=tid, name=tname, tag=TAG_ALIAS.get(tname) or tags.get(norm_name(tname)) or ''.join(w[0] for w in re.findall(r"[A-Za-z0-9']+", tname))[:4].upper(),
            region=region, tier=tier, league=label, rating=rating,
            budget=int(round(wage * 1.3 + (rating - 60) * (60000 if tier == 1 else 8000), -3)),
            reputation=0,   # 按联赛内排名定，见下面 league_reputation
            roster=roster, coach=None, facilities=max(30, min(95, rating + rng.randrange(-6, 7) + (0 if tier == 1 else -12))),
        ))

    # ---- 俱乐部声望：按联赛内的排名拉开，不直接跟总评走。
    # 声望决定谁愿意请一个没名气的经理（引擎里是「俱乐部声望 <= 经理声望 + 12」，新经理约 51）。
    # 跟着总评走的话 LPL 垫底的队也有 75，新经理一支 LPL 队都带不了——而现实里后段班本来就会请新人。
    # 每个联赛一个上限（赛区的分量），从第一名到最后一名线性落 SPAN 点。
    PRESTIGE = {'LCK': 93, 'LPL': 92, 'LEC': 85, 'LCS': 80, 'LCP': 74, 'CBLOL': 73}
    SPAN = 30
    by_league = collections.defaultdict(list)
    for t in teams_out:
        by_league[t['league']].append(t)
    for label, ts in by_league.items():
        ts.sort(key=lambda t: -t['rating'])
        top = PRESTIGE.get(ts[0]['region'], 70) if ts[0]['tier'] == 1 else PRESTIGE.get(ts[0]['region'], 70) - 36
        span = SPAN if ts[0]['tier'] == 1 else 12
        # 引擎里声望 <= 52 的俱乐部谁都愿意请（「总有地方可以起步」）。有二级联赛的赛区，那一层就是二级联赛；
        # 没有的赛区（2026 年的 LPL：LDL 停办了），让一级联赛垫底的队落到这条线以下，否则年轻经理在这个赛区无处可去
        if ts[0]['tier'] == 1 and not any(t['tier'] == 2 and t['region'] == ts[0]['region'] for t in teams_out):
            span = top - 50
        for i, t in enumerate(ts):
            t['reputation'] = int(round(top - span * i / max(1, len(ts) - 1)))

    # ---- 自由人：评分年份里打过世界内联赛、开季不在任何名单里、档案上没退役的人
    fa = []
    for (nm, pos), rows in by_player.items():
        if (nm, pos) in used or any((nm, p) in used for p in POS):
            continue
        if not any(r['league'] in codes or r['league'] in LINEAGE for r in rows):
            continue
        if max(r['year'] for r in rows) < Y - 1 or sum(r['n'] for r in rows) < 25:
            continue
        b = find_bio(nm, pos, '')
        if not b or b.get('is_retired') == '1':
            continue                                             # 没档案的不放进自由人池：不知道他是不是还在打
        attrs, eff = rate(nm, pos)
        overall = int(round(sum(attrs[k] * w for k, w in ROLE_WEIGHT[pos].items())))
        fa.append((overall, nm, pos, attrs, eff, b))
    fa.sort(key=lambda x: -x[0])
    for overall, nm, pos, attrs, eff, b in fa[:100]:
        rng = random.Random(f'{Y}:{nm}:{pos}')
        birth = b.get('birthdate') or None
        age = (Y - int(birth[:4])) if birth else 23
        champs = collections.Counter()
        for r in by_player[(nm, pos)]:
            champs.update(r['agg']['champs'])
        region = RESIDENCY_KEY.get(b.get('residency')) or 'LEC'
        players_out.append(dict(
            id=f'P{len(players_out) + 1}', ign=nm, teamId=None, region=region,
            nat=COUNTRY_ISO.get(b.get('country')), residency=RESIDENCY_KEY.get(b.get('residency')),
            realName=(b.get('name_cn') or b.get('real_name') or None), birth=birth, age=age, ageEstimated=birth is None,
            role=ROLE_CN[pos], roles=[ROLE_CN[pos]], isCaptain=False, games=int(round(eff)), attrs=attrs, overall=overall,
            potential=min(99, overall + int(max(0, 24 - age) * 2.2 + rng.random() * 4)),
            form=55 + rng.randrange(20), morale=55 + rng.randrange(20), fatigue=0,
            salary=int(round(33000 * math.exp((overall - 55) / 12) * 2.5 * .8, -3)),
            value=int(round(20000 * math.exp((overall - 55) / 10.5) * 2.5 * .6, -3)),
            contractYears=0, loyalty=35 + rng.randrange(50), ambition=35 + rng.randrange(55),
            champPool=[c for c, _ in champs.most_common(6)], champUse=dict(champs.most_common(30)), champWr={},
        ))

    world = dict(
        meta=dict(
            season=Y, game='lol', history=bool(args.history),
            sources={"Oracle's Elixir": '逐场比赛数据：名单、位置、英雄、全部统计',
                     'Leaguepedia': '中文名、真名、国籍、居民赛区、生日',
                     'Riot esports API': '战队简称'},
            derived=dict(
                measured=['laning', 'mechanics', 'teamfight', 'farming', 'awareness', 'clutch', 'teamwork'],
                inferred=dict(macro='运营 = 40% 运营 RAPM + 20% 队伍运营残差 + 40% 资历，每人的三项分量在 macroFrom 里。说的是他在场时队伍 15 分钟之后多赢多少，不指定谁是指挥；isCaptain 只是开局时运营最高的首发',
                              laning_fallback=f'{len(derived_lane)} 人没有 15 分钟数据，对线由分均经济与补刀反推',
                              awareness_fallback=f'{len(derived_aware)} 人没有视野数据，意识由阵亡占比与一血参与反推'),
                estimated='合同、薪资、身价、预算、设施、潜力、士气；没有生日的年龄',
                missing='教练（OE 没有教练，待从 Leaguepedia 补）'),
            leagueBase={k: round(v, 1) for k, v in base.items() if k in codes},
            leagueStrength={k: dict(logit=round(v, 2), games=bt_n.get(k, 0)) for k, v in bt.items()},
            roleWeight={ROLE_CN[p]: w for p, w in ROLE_WEIGHT.items()},
            yearWeights={str(k): v for k, v in year_w.items()},
        ),
        teams=teams_out, players=players_out,
    )
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    json.dump(world, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

    # ---- 报告
    print(f'\n-> {out_path}  {os.path.getsize(out_path) // 1024} KB', file=sys.stderr)
    print(f'战队 {len(teams_out)}，选手 {len(players_out)}（自由人 {sum(1 for p in players_out if not p["teamId"])}）', file=sys.stderr)
    print(f'国际赛拟合：' + '  '.join(f'{k} {v:+.2f}({bt_n.get(k, 0)}局)' for k, v in sorted(bt.items(), key=lambda x: -x[1])), file=sys.stderr)
    for code, region, tier, label in world_leagues:
        ts = [t for t in teams_out if t['league'] == label]
        if ts:
            best = max(ts, key=lambda t: t['rating']); worst = min(ts, key=lambda t: t['rating'])
            print(f'  {label:20s} {len(ts):2d} 队  均 {sum(t["rating"] for t in ts) / len(ts):.1f}  '
                  f'最强 {best["name"]} {best["rating"]}  最弱 {worst["name"]} {worst["rating"]}', file=sys.stderr)
    top = sorted(players_out, key=lambda p: -p['overall'])[:15]
    print('总评前 15：' + '  '.join(f'{p["ign"]}({p["role"]}{p["overall"]})' for p in top), file=sys.stderr)
    real_guests = sorted(k for k in guests if f'{k[1]}({k[0]})' not in skipped)
    if real_guests:
        print('按客队排除：' + '、'.join(f'{t}({l})' for l, t in real_guests), file=sys.stderr)
    if skipped:
        print(f'二级联赛未收录 {len(skipped)} 支（名单不全或排在第 {TIER2_MAX} 名之后）', file=sys.stderr)
    if holes:
        print('名单缺口：' + '；'.join(holes), file=sys.stderr)
    print(f'没有档案的在队选手 {len(no_bio)} 人' + (('：' + '、'.join(no_bio[:25]) + (' …' if len(no_bio) > 25 else '')) if no_bio else ''), file=sys.stderr)
    print(f'没有 15 分钟数据（对线为反推）{len(derived_lane)} 人；没有视野数据（意识为反推）{len(derived_aware)} 人', file=sys.stderr)


if __name__ == '__main__':
    main()
