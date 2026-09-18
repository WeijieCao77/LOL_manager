# -*- coding: utf-8 -*-
"""
把 OE 2015–2026 里大赛区 + 国际赛的行抽成一份紧凑缓存，供数值研究反复读。

    PYTHONIOENCODING=utf-8 python analysis/lol/extract_major.py

输出 analysis/lol/cache/major.pkl（不进仓库）：{'players': [...], 'teams': [...]}
只留研究用得到的列，数字已转成 float / None。
"""
import csv, os, pickle, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
DATA = os.environ.get('LOL_DATA_DIR') or os.path.join(os.path.dirname(REPO), 'lol选手', 'data')

# 联赛代码 -> 统一的赛区线（改过名的归到同一条线上）
LINE = {
    'LPL': 'LPL', 'LCK': 'LCK', 'LEC': 'LEC', 'EU LCS': 'LEC', 'LCS': 'LCS', 'NA LCS': 'LCS', 'LTA N': 'LCS',
    'MSI': 'INTL', 'WLDs': 'INTL', 'FST': 'INTL',
}
NUM = ['kills', 'deaths', 'assists', 'teamkills', 'teamdeaths', 'firstbloodkill', 'firstbloodassist',
       'dpm', 'damageshare', 'damagetakenperminute', 'cspm', 'earned gpm', 'earnedgoldshare', 'vspm', 'wpm', 'wcpm',
       'golddiffat15', 'xpdiffat15', 'csdiffat15', 'golddiffat10', 'gamelength', 'game',
       'doublekills', 'triplekills', 'quadrakills', 'pentakills', 'monsterkillsenemyjungle']
TEAM_NUM = ['golddiffat15', 'gamelength', 'firstdragon', 'dragons', 'firstbaron', 'barons', 'firsttower', 'towers',
            'firstherald', 'heralds', 'gspd', 'game']
KEEP = ['gameid', 'league', 'year', 'split', 'playoffs', 'date', 'side', 'position', 'playername', 'teamname',
        'champion', 'result', 'patch', 'datacompleteness']


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def main():
    players, teams = [], []
    for y in range(2015, 2027):
        path = os.path.join(DATA, 'oracleselixir', f'{y}_OE.csv')
        if not os.path.exists(path):
            continue
        n = 0
        with open(path, encoding='utf-8', errors='replace') as fh:
            for r in csv.DictReader(fh):
                line = LINE.get(r['league'])
                if not line:
                    continue
                row = {k: r.get(k) for k in KEEP}
                row['line'] = line
                row['year'] = y
                row['win'] = r['result'] == '1'
                if r['position'] == 'team':
                    for k in TEAM_NUM:
                        row[k] = num(r.get(k))
                    teams.append(row)
                else:
                    for k in NUM:
                        row[k] = num(r.get(k))
                    players.append(row)
                n += 1
        print(f'  {y}: {n} 行', file=sys.stderr)
    out = os.path.join(HERE, 'cache', 'major.pkl')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    pickle.dump(dict(players=players, teams=teams), open(out, 'wb'), protocol=pickle.HIGHEST_PROTOCOL)
    print(f'-> {out}  {os.path.getsize(out) // (1 << 20)} MB；选手行 {len(players)}，队伍行 {len(teams)}', file=sys.stderr)


if __name__ == '__main__':
    main()
