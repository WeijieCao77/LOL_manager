# 退役的核验（无畏契约专属）

这些脚本核验的是 VAL MANAGER 里存在、英雄联盟版里已经不存在或换了形态的机制。它们不再在
`npm run audit` 里跑。留在这里而不是删掉，是因为其中几个的**意图**在英雄联盟版里仍然需要
一个对应的核验，重写时可以参考。

| 脚本 | 核验的是什么 | 英雄联盟版的去向 |
|---|---|---|
| `audit_data.py` | vlr.gg 数据管线产物的完整性 | 管线换成 `scripts/lol/`，要重写一个 |
| `check_agents.ts` `check_agent_pro.ts` `check_agent_drill.ts` | 特工熟练度、自动选特工（写死了无畏契约的特工和地图） | 机制还在（英雄熟练度），**需要按英雄重写** |
| `check_comp.ts` | 位置覆盖：双决斗、缺控场扣多少 | 阵容打法改由英雄的实测倾向合成；BP 的规则由 `check_draft.ts` 管 |
| `check_igl.ts` `check_caller_sync.ts` | 每队一名指挥、主副指挥、没有指挥扣 4 分 | 已改成五人分担的「运营」+ 队长，由 `check_onoff.ts` 管；队长任命的部分**需要重写** |
| `check_drill_rates.ts` | 「只有指挥能涨指挥」等训练速率 | 运营人人都能练，**需要重写** |
| `check_veto_edge.ts` `check_midgame.ts` | 地图否决、七张图的图池轮换 | 只有一张图，机制不存在了 |
| `check_tactics.ts` `check_training.ts` | 跑图训练（写死了 Ascent / Bind / Sunset） | 机制还在（战术磨合度、打法熟练度），**需要重写** |
| `check_history_world.ts` `check_2023.ts` | 2023–2025 历史开档与 vct-2023 规则书 | 历史入口换成 2016 / 2022，做的时候重写 |
| `check_format.ts` `check_draws.ts` | VCT 2026 抽签赛制的细节（每赛区 12 队） | M3 写英雄联盟真实赛制时重写 |
| `check_tier2_path.ts` | 次级联赛 → Ascension → 升入一级联赛 | 联盟制没有升降级（`PROMOTION = false`） |
