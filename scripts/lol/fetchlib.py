#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
The one HTTP client every scraper in this project uses.

Politeness is enforced here rather than promised in a docstring, because a
promise in a docstring is what gets a project's IP banned. Every request in
this repo goes through `Session.get`, which means:

  - a throttle that cannot be skipped, per host, with a sane default
  - an identifying User-Agent carrying a contact address
  - 429 and 403 abort the whole run instead of retrying into the block
  - everything lands in a disk cache, so re-running a partial scrape costs
    nothing and a failure never loses what already worked
  - robots.txt is fetched once per host and honoured, and a disallowed path
    raises rather than being quietly requested anyway

The reference project this game is modelled on earned a temporary ban during
development by requesting a heavy endpoint every 2.2 seconds. That is the
entire reason this file exists as a chokepoint instead of each script rolling
its own `urlopen`.

Usage:

    from fetchlib import Session
    s = Session("liquipedia.net", min_interval=2.5)
    html = s.get("https://liquipedia.net/honorofkings/Main_Page")
"""
from __future__ import annotations

import gzip
import hashlib
import io
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent      # scripts/lol/ -> repo root
CACHE_DIR = ROOT / "scripts" / "cache"
RAW_DIR = ROOT / "data-raw"

# Every name in this project is Chinese, and the default Windows console
# encoding is cp1252 — so the first line any scraper prints kills it with a
# UnicodeEncodeError before a single request goes out. Fixed once, here,
# because every script in scripts/ imports this module.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")                    # type: ignore[union-attr]
    except (AttributeError, ValueError):
        pass

# Identifies the project and gives them somebody to write to. Sites that want
# to complain should be able to; an anonymous scraper is one that cannot be
# asked to stop.
UA = ("LolManagerBuild/0.1 (non-commercial fan esports-manager project; "
      "contact: yankejing711@gmail.com)")

# Per-host floors, in seconds. Anything not listed gets DEFAULT_INTERVAL.
#
# Liquipedia's number is not ours to choose — it is written in their API terms
# ("no more than 1 request per 2 seconds", and action=parse no more than once
# per 30 seconds). The rest are deliberately slower than any site is likely to
# require, because this is a one-off build of a static data file and there is
# nothing to gain from going faster.
HOST_INTERVAL = {
    "liquipedia.net": 2.5,
    "wanplus.com": 3.0,
    "www.wanplus.com": 3.0,
    "kpl.qq.com": 3.0,
    "pvp.qq.com": 3.0,
    "camp.qq.com": 3.0,
    "escharts.com": 3.0,
}
DEFAULT_INTERVAL = 3.0

# An image on a CDN is cheaper to serve than a rendered page, but not free.
IMAGE_INTERVAL = 1.0


class RateLimited(RuntimeError):
    """The site asked us to stop. Stop, save what we have, and come back later."""


class Disallowed(RuntimeError):
    """robots.txt says no. That is the end of the conversation."""


def _slug(url: str) -> str:
    """A stable filename for a URL, short enough for Windows."""
    h = hashlib.sha1(url.encode("utf-8")).hexdigest()[:16]
    tail = urllib.parse.urlparse(url).path.strip("/").replace("/", "_")[-40:]
    safe = "".join(c if c.isalnum() or c in "._-" else "-" for c in tail)
    return f"{safe}-{h}" if safe else h


class Session:
    """
    A throttled, cached, robots-respecting client for exactly one host.

    One per host on purpose: the throttle is per host, and sharing a clock
    across hosts would either slow everything to the slowest site or let a
    burst through to the strictest one.
    """

    def __init__(self, host: str, min_interval: float | None = None,
                 cache_name: str | None = None, respect_robots: bool = True,
                 robots_exempt: tuple[str, ...] = (), exempt_reason: str = ""):
        """
        `robots_exempt` is a list of path prefixes that this session may fetch
        even though robots.txt disallows them, and it exists for exactly one
        situation: a site whose robots.txt blocks an endpoint that its own
        published terms explicitly invite you to use.

        Liquipedia is that situation, and it is worth spelling out because it
        looks like a violation and is the opposite of one. Their robots.txt has
        `Disallow: /honorofkings/api.php` under `User-agent: *` — aimed at
        search engines, which have no business indexing an API endpoint. Their
        API Terms of Use then say, in as many words, "Liquipedia is pleased to
        provide free access to the information in our wikis through the
        MediaWiki API for use in your own projects", and set out the conditions
        (1 request / 2s, identifying User-Agent with contact, gzip, cache
        aggressively, attribute under CC-BY-SA 3.0).

        The same page forbids the thing robots.txt appears to permit:
        "Automated access to non-API endpoints (ie, generated HTML pages) is
        not permitted." So reading robots.txt alone and scraping article HTML
        instead would be the actual violation.

        Every exemption must carry a reason, and the reason is printed, so this
        can never quietly become a way to switch robots.txt off.
        """
        self.host = host
        self.robots_exempt = robots_exempt
        if robots_exempt and not exempt_reason:
            raise ValueError("robots_exempt 必须附带 exempt_reason——没有理由就不能豁免")
        self.exempt_reason = exempt_reason
        self.min_interval = (min_interval if min_interval is not None
                             else HOST_INTERVAL.get(host, DEFAULT_INTERVAL))
        self._last = 0.0
        self.cache = CACHE_DIR / (cache_name or f"http_{host.replace('.', '_')}")
        self.cache.mkdir(parents=True, exist_ok=True)
        self.requests = 0
        self.from_cache = 0
        self._robots: urllib.robotparser.RobotFileParser | None = None
        self._robots_txt: str | None = None
        if respect_robots:
            self._load_robots()

    # ------------------------------------------------------------ robots.txt
    def _load_robots(self) -> None:
        url = f"https://{self.host}/robots.txt"
        rp = urllib.robotparser.RobotFileParser()
        try:
            raw = self._raw_get(url, throttle=False)
            self._robots_txt = raw.decode("utf-8", "replace")
            rp.parse(self._robots_txt.splitlines())
        except Exception as e:                                  # noqa: BLE001
            # No robots.txt is not permission to hammer the site; it just means
            # there is no machine-readable rule. The throttle still applies.
            print(f"  [robots] {self.host}: 读不到 robots.txt（{e}），按默认限速处理")
            rp = None
        self._robots = rp
        if self.robots_exempt:
            print(f"  [robots] {self.host}: 按站方条款豁免 {list(self.robots_exempt)}"
                  f" —— {self.exempt_reason}")

    @property
    def robots_txt(self) -> str | None:
        return self._robots_txt

    def allowed(self, url: str) -> bool:
        path = urllib.parse.urlparse(url).path
        if any(path.startswith(p) for p in self.robots_exempt):
            return True
        if self._robots is None:
            return True
        return self._robots.can_fetch(UA, url) or self._robots.can_fetch("*", url)

    # ------------------------------------------------------------ requesting
    def _throttle(self, gap: float) -> None:
        wait = gap - (time.monotonic() - self._last)
        if wait > 0:
            time.sleep(wait)
        self._last = time.monotonic()

    def _raw_get(self, url: str, throttle: bool = True,
                 gap: float | None = None, headers: dict | None = None,
                 tries: int = 4) -> bytes:
        """
        One request, with the two failure modes kept strictly apart.

        A dropped TLS handshake or a timeout is the network being the network:
        worth retrying, with a widening gap. HTTP 429 or 403 is the site
        telling us to stop, and retrying that is how a temporary block becomes
        a permanent one — so it aborts the whole run and the caller saves what
        it has. Collapsing the two into one `except` is what turns a blip into
        a lost hour of throttled scraping, and a ban into a worse ban.
        """
        last: Exception | None = None
        for attempt in range(tries):
            if throttle:
                self._throttle(self.min_interval if gap is None else gap)
            h = {"User-Agent": UA, "Accept-Encoding": "gzip, deflate"}
            if headers:
                h.update(headers)
            req = urllib.request.Request(url, headers=h)
            try:
                with urllib.request.urlopen(req, timeout=45) as r:
                    raw = r.read()
                    enc = (r.headers.get("Content-Encoding") or "").lower()
                    if enc == "gzip":
                        raw = gzip.decompress(raw)
                    elif enc == "deflate":
                        raw = zlib.decompress(raw, -zlib.MAX_WBITS)
                    self.requests += 1
                    return raw
            except urllib.error.HTTPError as e:
                if e.code in (403, 429):
                    retry = e.headers.get("Retry-After") if e.headers else None
                    raise RateLimited(
                        f"{self.host} 返回 HTTP {e.code}"
                        f"{f'（Retry-After: {retry}）' if retry else ''}。"
                        "已停止并保存进度——请稍后再跑，不要重试硬撞。"
                    ) from e
                if 500 <= e.code < 600 and attempt < tries - 1:
                    last = e
                    time.sleep(2.0 * (attempt + 1))
                    continue
                raise
            except (urllib.error.URLError, TimeoutError, OSError) as e:
                if attempt >= tries - 1:
                    raise
                last = e
                wait = 2.0 * (attempt + 1)
                print(f"    [重试 {attempt + 1}/{tries - 1}] {type(e).__name__}"
                      f"，{wait:.0f}s 后再试", flush=True)
                time.sleep(wait)
        raise last if last else RuntimeError("unreachable")

    def get(self, url: str, *, binary: bool = False, gap: float | None = None,
            refresh: bool = False, headers: dict | None = None):
        """
        Fetch a URL, from disk if we already have it.

        The cache is the reason a scrape can be interrupted and resumed without
        costing the site a single extra request.
        """
        if not self.allowed(url):
            raise Disallowed(f"robots.txt 不允许抓取 {url}")

        key = self.cache / (_slug(url) + (".bin" if binary else ".txt"))
        if key.exists() and not refresh:
            self.from_cache += 1
            return key.read_bytes() if binary else key.read_text(encoding="utf-8")

        raw = self._raw_get(url, gap=gap, headers=headers)
        if binary:
            key.write_bytes(raw)
            return raw
        text = raw.decode("utf-8", "replace")
        key.write_text(text, encoding="utf-8")
        return text

    def get_json(self, url: str, **kw):
        return json.loads(self.get(url, **kw))

    def image(self, url: str, refresh: bool = False) -> bytes:
        return self.get(url, binary=True, gap=IMAGE_INTERVAL, refresh=refresh)

    def report(self) -> str:
        return (f"{self.host}: {self.requests} 次真实请求，"
                f"{self.from_cache} 次命中缓存（间隔 ≥{self.min_interval}s）")


# ---------------------------------------------------------------- small helpers
def load_json(path: Path, default):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def save_json(path: Path, data) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    # write beside then replace, so an interrupted write cannot truncate a
    # cache that took an hour of throttled requests to build
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, p)


def save_image(raw: bytes, dest: Path, side: int = 256, quality: int = 82,
               square_crop: bool = True) -> int:
    """
    Normalise a downloaded image into the repo.

    Everything is re-encoded rather than stored as fetched: it bounds the size
    of the repo, strips whatever metadata came along, and means the game only
    ever loads one format. Transparency is kept — a crest with a baked-in
    background fights whatever the card tints it.
    """
    from PIL import Image                                        # noqa: PLC0415

    im = Image.open(io.BytesIO(raw)).convert("RGBA")
    if square_crop:
        w, h = im.size
        if w > h:
            x = (w - h) // 2
            im = im.crop((x, 0, x + h, h))
        elif h > w:
            im = im.crop((0, 0, w, w))       # keep the head, drop the jersey
        im = im.resize((side, side), Image.LANCZOS)
    else:
        s = max(im.size)
        canvas = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        canvas.paste(im, ((s - im.width) // 2, (s - im.height) // 2), im)
        im = canvas.resize((side, side), Image.LANCZOS)
    dest.parent.mkdir(parents=True, exist_ok=True)
    im.save(dest, "WEBP", quality=quality, method=6)
    return dest.stat().st_size


def is_placeholder(raw: bytes) -> bool:
    """
    A grey cut-out standing in for a person, dressed up as a photograph.

    Most sites serve a default silhouette when they have no picture, and it
    arrives looking exactly like a real download. No press photograph is
    entirely colourless, so near-zero saturation is the tell.
    """
    from PIL import Image                                        # noqa: PLC0415

    try:
        im = Image.open(io.BytesIO(raw)).convert("RGB").resize((64, 64))
    except OSError:
        return True
    px = list(im.getdata())
    sat = sum(max(p) - min(p) for p in px) / len(px)
    return sat < 3.0
