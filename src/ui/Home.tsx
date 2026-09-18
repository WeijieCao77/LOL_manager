/**
 * The front page: two games, one account.
 *
 * Everything here is read-only and cheap. Neither game's bundle is loaded
 * until a card is clicked — this page exists partly so that a visitor who is
 * only looking downloads a page rather than a simulation.
 *
 * The career used to live at `/`, so most of the people who open this already
 * have a save. That is why the manager card leads with 「继续上次存档」 and the
 * club it belongs to: a returning player should recognise their own game from
 * the front page, not wonder where it went.
 */
import { lazy, Suspense, useEffect, useState } from 'react'
import { readCareerPreview } from '../engine/savePreview'
import { homeCrestUrl, HOME_COUNTS } from '../engine/homeClubs'
import { ENDING_COUNT } from '../engine/endings'
import { ACHIEVEMENT_COUNT } from '../engine/achievements'
import { readProfile, siteId, syncProfile, type Profile } from '../engine/profile'
import { REGION_CN } from '../engine/types'
import type { Region } from '../engine/types'
import { maskId } from '../engine/cardid'
import Support from './Support'
import { track } from '../engine/telemetry'
import Changelog from './Changelog'
import WeChat from './WeChat'
import ThemeToggle from './ThemeToggle'

/** The account panel is loaded when it is opened, not when the page is. */
const Account = lazy(() => import('./Account'))

type Mode = 'home' | 'career'

/** The six tier-one regions, in the order the world file lists them. */
const HOME_REGIONS: Region[] = ['LPL', 'LCK', 'LEC', 'LCS', 'LCP', 'CBLOL']

interface Resume {
  club: string | null
  clubId: string | null
  year: number
  over: boolean
}

export default function Home({ onOpen }: { onOpen: (m: Mode) => void }) {
  const [resume, setResume] = useState<Resume | null>(null)
  const [profile, setProfile] = useState<Profile>(() => readProfile())
  // The id itself lives in Account.tsx now — this only needs to know whether
  // there is one, and to hear about it when that changes.
  const [id, setId] = useState<string | null>(() => siteId())
  const [acct, setAcct] = useState(false)


  // Reading the autosave means parsing a whole world, so it happens after the
  // page has painted rather than before it.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        setResume(readCareerPreview())
      } catch { /* a save this page cannot read is the career screen's problem */ }
    }, 0)
    return () => clearTimeout(t)
  }, [])

  // Pull anything unlocked on another device. Union only — see engine/profile.ts.
  useEffect(() => {
    let alive = true
    void syncProfile().then((p) => { if (alive) setProfile(p) })
    return () => { alive = false }
  }, [])


  const endings = profile.endings.length
  const badges = profile.achievements.length

  return (
    <div className="home">
      <header className="home-bar">
        <div className="home-mark">
          猪之家<span>游戏</span>
        </div>
        <div className="spacer" />
        <ThemeToggle compact />
        <button
          className="home-id"
          onClick={() => setAcct(true)}
          title={id ? '账号设置：查看、复制或换一个 ID' : '创建一个 ID，成就和结局才能跨设备保存'}
        >
          <span className="k">ID</span>
          <b className="mono">{id ? maskId(id) : '创建账号'}</b>
        </button>
      </header>

      <section className="home-hero">
        <h1>英雄联盟电竞经理</h1>
        <p>
          全部免费，打开就能玩，不用注册。
          {id
            ? ' 成就和结局都记在你的 ID 上。'
            : ' 想跨设备保留成就和结局，可以在右上角创建一个 ID。'}
        </p>
      </section>

      <div className="home-cards">
        {/* ---------------------------------------------------------- 经理 */}
        <article className="home-card">
          <div className="home-art crests">
            {HOME_REGIONS.map((r) => (
              <div key={r} className="home-region">
                <b className="mono">{r}</b>
                <span>{REGION_CN[r]}</span>
              </div>
            ))}
          </div>
          <div className="home-body">
            <h2>LOL 电竞经理</h2>
            <p className="lede">英雄联盟电竞经理模拟</p>
            <p className="blurb">
              接手一支真实战队，从 2026 出发。
              签人、训练、排兵、BP、谈赞助，打满五年可以收官领结局，
              也可以一直带到 2036。
              {HOME_COUNTS.players} 名选手和 {HOME_COUNTS.headCoaches} 名已收录主教练全是真人，没有程序生成的。
            </p>
            <ul className="home-facts">
              <li><b>{HOME_COUNTS.teams}</b> 支战队 · 六大赛区与次级联赛</li>
              <li><b>{ENDING_COUNT}</b> 种结局 · <b>{ACHIEVEMENT_COUNT}</b> 项成就</li>
            </ul>
            <div className="home-go">
              <button className="primary" onClick={() => { track('home_go', { go: 'career' }); onOpen('career') }}>
                {resume ? (resume.over ? '查看结果' : '继续上次存档') : '开始执教'}
              </button>
              {resume && (
                <span className="home-resume">
                  {homeCrestUrl(resume.clubId) && <img className="crest" src={homeCrestUrl(resume.clubId)!} alt="" aria-hidden="true" loading="lazy" width={16} height={16} style={{ width: 16, height: 16 }} />}
                  {resume.club} · {resume.year} 年
                </span>
              )}
            </div>
          </div>
        </article>

      </div>

      {/* ------------------------------------------ 账号一览，和工作室的另一款 */}
      <div className="home-cards home-row">
      <section className="home-strip">
        <div className="home-stat">
          <span className="k">结局</span>
          <span className="v">{endings}<em>/{ENDING_COUNT}</em></span>
        </div>
        <div className="home-stat">
          <span className="k">成就</span>
          <span className="v">{badges}<em>/{ACHIEVEMENT_COUNT}</em></span>
        </div>
        <div className="home-stat">
          <span className="k">执教生涯</span>
          <span className="v">{profile.record.careers}<em> 段</em></span>
        </div>
        <div className="home-stat">
          <span className="k">累计冠军</span>
          <span className="v">{profile.record.titles}<em> 座</em></span>
        </div>
        <p className="tiny faint home-note">
          这些记在你的 ID 上，跨存档累计，被解雇不清零。
          换设备时把 ID 填回来就能找回。
          <b>ID 相当于密码，不要发给别人</b>。
        </p>
      </section>

      {/* The studio's other game. A plain link out, tracked like the button
          above so the funnel can see whether anyone follows it. */}
      <a
        className="home-promo"
        href="https://www.poxiao.lol"
        target="_blank"
        rel="noopener"
        onClick={() => track('home_go', { go: 'poxiao' })}
      >
        <img
          src={`${import.meta.env.BASE_URL}promo/poxiao.webp`}
          alt="破晓 · LOL 电竞生涯模拟"
          loading="lazy"
        />
        <div className="home-promo-body">
          <span className="k">工作室的另一款游戏</span>
          <h3>破晓<em>LOL 电竞生涯模拟</em></h3>
          <p>S12 到 S16，五年。一段有限的职业生涯，去终结那个王朝。</p>
          <span className="home-promo-go">www.poxiao.lol ↗</span>
        </div>
      </a>
      </div>

      <footer className="home-foot">
        <span>猪之家出品 · 小红书/抖音 @点点点点点点点点 · @Greenle4f</span>
        <span className="faint">游戏全部免费</span>
      </footer>

      {acct && (
        <Suspense fallback={null}>
          <Account
            onClose={() => setAcct(false)}
            onChange={(next) => { setId(next); setProfile(readProfile(next)) }}
          />
        </Suspense>
      )}
      <WeChat />
      <Changelog />
      <Support />
    </div>
  )
}
