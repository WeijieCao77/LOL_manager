#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Liquipedia -> data-raw/lol/：各队的教练组，以及缺生日的年轻选手的生日 / 国籍 / 真名。

    python scripts/lol/fetch_liquipedia.py                # 教练
    python scripts/lol/fetch_liquipedia.py --players      # 再补新秀候选人的选手页（先跑 build_prospects.py --candidates）

只走 api.php 的批量查询（一次 50 个标题，间隔 >= 2.5 秒）。Liquipedia 的 API 条款许可第三方项目用
MediaWiki API、禁止自动抓取 HTML 页面，并把 action=parse 限到 30 秒一次——这里从不用 parse。
限速、带联系方式的 UA、遇到 429/403 整体中止、磁盘缓存、robots，都在 fetchlib.py 里强制执行
（同一位作者王者荣耀经理项目的抓取库，原样拿来）。

Oracle's Elixir 没有教练，Leaguepedia 的 Cargo 查询对匿名请求限流到一条都过不去，
而 Liquipedia 每个赛事页的参赛名单（TeamCard）里写着每支队的教练组和职务。
"""
from __future__ import annotations

import argparse, json, re, sys, urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetchlib import Session, ROOT  # noqa: E402

API = "https://liquipedia.net/leagueoflegends/api.php"
OUT = ROOT / "data-raw" / "lol"
BATCH = 50

# 2026 年各联赛的赛段页。名字是猜的，不存在的页面查询会直接告诉我们，不会报错。
LEAGUE_PAGES = {
    "LPL": ["LPL/2026/Split 1", "LPL/2026/Split 2", "LPL/2026/Split 3"],
    "LCK": ["LCK/2026/Cup", "LCK/2026/Rounds 1-2", "LCK/2026/Rounds 3-5", "LCK/2026/Rounds 3-4", "LCK/2026"],
    "LEC": ["LEC/2026/Versus", "LEC/2026/Spring", "LEC/2026/Summer"],
    "LCS": ["LCS/2026/Lock-In", "LCS/2026/Spring", "LCS/2026/Summer"],
    "LCP": ["LCP/2026/Split 1", "LCP/2026/Split 2", "LCP/2026/Split 3"],
    "CBLOL": ["CBLOL/2026/Cup", "CBLOL/2026/Split 1", "CBLOL/2026/Split 2"],
    "LCK CL": ["LCK Challengers League/2026/Kickoff", "LCK Challengers League/2026/Rounds 1-2",
               "LCK Challengers League/2026/Rounds 3-5", "LCK CL/2026/Kickoff", "LCK CL/2026/Rounds 1-2"],
    "NACL": ["NACL/2026/Split 1", "NACL/2026/Split 2", "NACL/2026/Spring", "NACL/2026/Summer",
             "North American Challengers League/2026/Split 1", "North American Challengers League/2026/Split 2"],
    "LFL": ["LFL/2026/Winter", "LFL/2026/Spring", "LFL/2026/Summer"],
    "PCS": ["PCS/2026/Split 1", "PCS/2026/Split 2", "PCS/2026/Split 3", "PCS/2026/Spring", "PCS/2026/Summer"],
    "Circuito Desafiante": ["Circuito Desafiante/2026/Split 1", "Circuito Desafiante/2026/Split 2",
                            "Circuito Desafiante/2026/Split 3"],
}
JOB = {"head coach": "head", "coach": "assistant", "assistant coach": "assistant", "strategic coach": "assistant",
       "positional coach": "assistant", "analyst": "analyst", "manager": None, "general manager": None}


def sess() -> Session:
    return Session(
        "liquipedia.net", min_interval=2.5,
        robots_exempt=("/leagueoflegends/api.php",),
        exempt_reason=("Liquipedia API 条款明确许可 MediaWiki API 用于第三方项目，"
                       "并明确禁止自动抓取 HTML 页面——只走 API 才是合规路径"),
    )


def wikitext(s: Session, titles: list[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    uniq = list(dict.fromkeys(t for t in titles if t))
    for i in range(0, len(uniq), BATCH):
        chunk = uniq[i:i + BATCH]
        q = urllib.parse.urlencode(dict(action="query", prop="revisions", rvprop="content", rvslots="main",
                                        titles="|".join(chunk), redirects="1", format="json", formatversion="2"))
        d = json.loads(s.get(f"{API}?{q}"))
        back = {r["to"]: r["from"] for r in d.get("query", {}).get("redirects", [])}
        back.update({n["to"]: n["from"] for n in d.get("query", {}).get("normalized", [])})
        for pg in d.get("query", {}).get("pages", []):
            if pg.get("missing") or not pg.get("revisions"):
                continue
            text = pg["revisions"][0]["slots"]["main"]["content"]
            out[pg["title"]] = text
            if pg["title"] in back:
                out[back[pg["title"]]] = text
    return out


def team_cards(text: str) -> list[dict]:
    """Every {{TeamCard}} on a tournament page: the club and its staff by job."""
    cards = []
    for m in re.finditer(r"\{\{TeamCard\b", text):
        depth, i = 0, m.start()
        while i < len(text):
            if text.startswith("{{", i): depth += 1; i += 2; continue
            if text.startswith("}}", i):
                depth -= 1; i += 2
                if depth == 0: break
                continue
            i += 1
        body = text[m.start():i]
        # top-level |key=value pairs only
        f: dict[str, str] = {}
        for part in re.split(r"\n?\|(?=[A-Za-z0-9]+\s*=)", body):
            if "=" in part:
                k, v = part.split("=", 1)
                f[k.strip()] = re.sub(r"\}\}\s*$", "", v).strip()
        team = f.get("team")
        if not team:
            continue
        staff = []
        for k, v in f.items():
            mm = re.fullmatch(r"(t\d+)?pos(\d+)|(t\d+)pos(\d+)", k)
            if not mm:
                continue
            job = JOB.get(v.lower().strip(), "skip") if v else "skip"
            if job in ("skip", None):
                continue
            prefix = (mm.group(1) or mm.group(3) or "")
            idx = mm.group(2) or mm.group(4)
            name = f.get(f"{prefix}p{idx}", "").strip()
            if name and not f.get(f"{prefix}p{idx}dnp"):
                staff.append(dict(name=name, job=job))
        players = [f[k] for k in ("p1", "p2", "p3", "p4", "p5") if f.get(k)]
        heads = [x for x in staff if x["job"] == "head"]
        if len(heads) > 1:                       # 'coach' beside a 'head coach' is an assistant
            pass
        cards.append(dict(team=team, players=players, staff=staff))
    return cards


def participants(text: str) -> list[dict]:
    """The newer {{TeamParticipants|{{Opponent|TEAM|players={{Persons|{{Person|...}}}}}}}} form."""
    out = []
    # a |qualification={{…}} line may sit between the club's name and its |players=
    for m in re.finditer(r"\{\{Opponent\|([^\n|}]+)\s*(?:\|qualification=\{\{[^\n]*\}\}\s*)?\|players=\{\{Persons", text):
        team = m.group(1).strip()
        depth, i = 0, m.start()
        while i < len(text):
            if text.startswith("{{", i): depth += 1; i += 2; continue
            if text.startswith("}}", i):
                depth -= 1; i += 2
                if depth == 0: break
                continue
            i += 1
        body = text[m.start():i]
        players, staff = [], []
        for pm in re.finditer(r"\{\{Person\|([^{}]*)\}\}", body):
            parts = [x.strip() for x in pm.group(1).split("|")]
            kv = dict(x.split("=", 1) for x in parts if "=" in x)
            name = next((x for x in parts if "=" not in x and x), "")
            role = kv.get("role", "").lower().strip()
            if not name:
                continue
            if kv.get("type") == "staff" or "coach" in role:
                staff.append(dict(name=name, job="head" if role == "head coach" else "assistant" if "coach" in role else "analyst" if "analyst" in role else None))
            elif kv.get("played") != "false":
                players.append(name)
        staff = [x for x in staff if x["job"]]
        out.append(dict(team=team, players=players, staff=staff))
    return out


def infobox(text: str) -> dict:
    def field(key):
        m = re.search(r"^\|\s*" + key + r"\s*=\s*(.*)$", text, flags=re.M)
        return re.sub(r"<[^>]+>|\[\[|\]\]", "", m.group(1)).strip() if m else None
    born = field("birth_date")
    m = re.search(r"(\d{4})[-|](\d{1,2})[-|](\d{1,2})", born or "")
    return dict(
        born=f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}" if m else None,
        country=field("country"), name=field("name"), romanized=field("romanized_name"),
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--players", action="store_true")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    s = sess()

    if not args.players:
        titles = [t for ts in LEAGUE_PAGES.values() for t in ts]
        pages = wikitext(s, titles)
        coaches: dict[str, dict] = {}
        found = {}
        for league, ts in LEAGUE_PAGES.items():
            hit = [t for t in ts if t in pages]
            found[league] = hit
            for t in hit:                      # later splits overwrite earlier ones; the game opens in January, so keep the FIRST non-empty
                for card in team_cards(pages[t]) + participants(pages[t]):
                    if card["staff"] and card["team"] not in coaches:
                        coaches[card["team"]] = dict(league=league, page=t, players=card["players"], staff=card["staff"])
        json.dump(dict(source="Liquipedia (CC BY-SA 3.0)，赛事页 TeamCard 的教练组", pages=found, teams=coaches),
                  open(OUT / "coaches_2026.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        for league, hit in found.items():
            n = sum(1 for c in coaches.values() if c["league"] == league)
            print(f"  {league:20s} 页面 {len(hit)}/{len(LEAGUE_PAGES[league])}  有教练的队 {n}")
        print(f"-> {OUT / 'coaches_2026.json'}  {len(coaches)} 支队")
        return 0

    cand = json.load(open(OUT / "prospect_candidates.json", encoding="utf-8"))
    need = [c["ign"] for c in cand if not c.get("born")]
    pages = wikitext(s, need)
    got = {}
    for ign in need:
        if ign in pages and "Infobox player" in pages[ign]:
            info = infobox(pages[ign])
            if info["born"] or info["country"]:
                got[ign] = info
    json.dump(dict(source="Liquipedia (CC BY-SA 3.0)，选手页 Infobox", players=got),
              open(OUT / "prospect_births.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"缺生日的候选人 {len(need)}，Liquipedia 上找到 {len(got)}（其中有生日的 {sum(1 for v in got.values() if v['born'])}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
