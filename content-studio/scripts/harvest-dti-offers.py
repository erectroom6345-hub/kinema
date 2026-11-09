#!/usr/bin/env python3
"""Harvest DTI CASH usable offers into input/affiliate-offers-adult-en.json.

Auth (one of):
  A) env ADULT_EN_DTI_USER_ID + ADULT_EN_DTI_PASSWORD  → script logs in
  B) --cookies-file path  → Netscape/HTTP cookie jar from a logged-in browser session

Then:
  - prefer CSV / 広告素材 export if present in member area
  - else scrape 加盟サイト pages for English Click/Direct URLs
  - keep only offers with clickUrl containing the user id
  - clothed creatives still need visual gate later (status=pending_clothed if no banner)

Usage:
  ADULT_EN_DTI_PASSWORD='...' python3 scripts/harvest-dti-offers.py
  python3 scripts/harvest-dti-offers.py --cookies-file /tmp/dti-cookies.txt
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urljoin

ROOT = Path(__file__).resolve().parents[1]
OFFERS_PATH = ROOT / "input/affiliate-offers-adult-en.json"
DISCOVERY_PATH = ROOT / "output/adult-en/dti-usable-discovery.json"

try:
    import requests
except ImportError:
    print("pip install requests が必要です", file=sys.stderr)
    sys.exit(1)

LOGIN_CANDIDATES = [
    "https://www.dticash.com/",
    "https://www.dticash.com/member/",
    "https://affiliate.dtiserv.com/",
]


def load_env_password() -> tuple[str, str]:
    uid = os.environ.get("ADULT_EN_DTI_USER_ID", "").strip()
    pw = os.environ.get("ADULT_EN_DTI_PASSWORD", "").strip()
    # fallback: read .env without printing
    env_path = ROOT / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith("ADULT_EN_DTI_USER_ID=") and not uid:
                uid = line.split("=", 1)[1].strip().strip('"').strip("'")
            if line.startswith("ADULT_EN_DTI_PASSWORD=") and not pw:
                pw = line.split("=", 1)[1].strip().strip('"').strip("'")
    return uid, pw


def session_from_cookies(path: Path) -> requests.Session:
    s = requests.Session()
    s.headers["User-Agent"] = "Mozilla/5.0"
    for line in path.read_text().splitlines():
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) >= 7:
            # Netscape cookie
            domain, _, cpath, _, _, name, value = parts[:7]
            s.cookies.set(name, value, domain=domain.lstrip("."), path=cpath)
        elif "=" in line:
            name, value = line.split("=", 1)
            s.cookies.set(name.strip(), value.strip())
    return s


def try_login(uid: str, pw: str) -> requests.Session:
    """DTI CASH front door is a JS app — use Playwright, then copy cookies into requests."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as e:
        raise RuntimeError("playwright が必要です: pip3 install playwright && python3 -m playwright install chromium") from e

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()
        page.goto("https://www.dticash.com/", wait_until="domcontentloaded", timeout=60000)
        page.wait_for_selector("#userid, input[placeholder='Affiliate ID'], input[placeholder='アフィリエイトID']", timeout=30000)
        user_box = page.locator("#userid")
        if user_box.count() == 0:
            user_box = page.get_by_placeholder(re.compile(r"Affiliate ID|アフィリエイトID"))
        pass_box = page.locator("#password")
        if pass_box.count() == 0:
            pass_box = page.get_by_placeholder(re.compile(r"Password|パスワード"))
        user_box.first.fill(uid)
        pass_box.first.fill(pw)
        login_btn = page.locator("button:has-text('LOGIN'), button:has-text('ログイン')")
        login_btn.first.click()
        page.wait_for_timeout(5000)
        html = page.content()
        ok = any(
            k in html
            for k in [
                "広告素材",
                "加盟サイト",
                "ログアウト",
                "Logout",
                "ClickID",
                "ダッシュボード",
                "Creatives",
                "Sites",
                "Dashboard",
            ]
        )
        if not ok:
            title = page.title()
            url = page.url
            browser.close()
            raise RuntimeError(f"ログイン失敗（title={title!r} url={url}）。パスワードを確認してください。")
        # export cookies to requests
        s = requests.Session()
        s.headers["User-Agent"] = "Mozilla/5.0"
        for c in context.cookies():
            s.cookies.set(c["name"], c["value"], domain=c.get("domain"), path=c.get("path", "/"))
        browser.close()
        print("login ok via playwright")
        return s


def extract_click_urls(html: str, uid: str) -> list[str]:
    urls = set(re.findall(r"https?://click\.dtiserv2\.com/[^\s\"'<>]+", html))
    urls |= set(re.findall(r"https?://click\.d2pass\.com/[^\s\"'<>]+", html))
    urls |= set(re.findall(r"https?://clear-tv\.com/(?:Click\d*|Direct|Join)/[^\s\"'<>]+", html))
    out = []
    for u in urls:
        if uid in u:
            out.append(u.rstrip(").,;"))
    return sorted(set(out))


def harvest_with_playwright(uid: str, pw: str) -> dict:
    """Login + crawl member pages in one Playwright session (JS app)."""
    from playwright.sync_api import sync_playwright

    found: dict[str, set[str]] = {}
    csv_hits: list[str] = []
    site_meta: list[dict] = []
    seen_pages: list[str] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto("https://www.dticash.com/", wait_until="domcontentloaded", timeout=60000)
        page.wait_for_selector("#userid", timeout=30000)
        page.locator("#userid").fill(uid)
        page.locator("#password").fill(pw)
        page.locator("button:has-text('LOGIN'), button:has-text('ログイン')").first.click()
        page.wait_for_url("**/dashboard**", timeout=30000)
        print("login ok via playwright")

        def site_key(u: str) -> str:
            m = re.search(rf"/(?:Click\d*|Direct|Join)/(?:\d+-)?(\d+)-{re.escape(uid)}\b", u)
            return m.group(1) if m else "unknown"

        def absorb(html: str) -> None:
            for u in extract_click_urls(html, uid):
                found.setdefault(site_key(u), set()).add(u)
            for href in re.findall(r'href=["\']([^"\']+\.csv[^"\']*)["\']', html, re.I):
                csv_hits.append(urljoin(page.url, href))

        page.goto("https://www.dticash.com/sites", wait_until="networkidle", timeout=60000)
        page.wait_for_timeout(1000)
        seen_pages.append(page.url)
        html = page.content()
        absorb(html)
        site_ids = sorted({int(x) for x in re.findall(r"/sites/(\d+)", html)})
        print(f"sites listed: {len(site_ids)}")

        for sid in site_ids:
            url = f"https://www.dticash.com/sites/{sid}"
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=30000)
                page.wait_for_timeout(700)
                # ClickID tab reveals input values
                tab = page.get_by_text("ClickID", exact=False)
                if tab.count():
                    tab.first.click()
                    page.wait_for_timeout(400)
                seen_pages.append(page.url)
                html = page.content()
                absorb(html)
                # also read input values (not always in raw hrefs until tab open)
                vals = page.eval_on_selector_all(
                    "input[type='text'], textarea",
                    "els => els.map(e => e.value || '').filter(Boolean)",
                )
                for v in vals:
                    absorb(v)
                site_meta.append(
                    {
                        "siteId": sid,
                        "url": page.url,
                        "title": page.title(),
                        "urls": sorted(found.get(str(sid), [])),
                    }
                )
                print(f"site {sid}: {len(found.get(str(sid), []))} urls")
            except Exception as e:
                print("site fail", sid, e)

        browser.close()

    return {
        "userId": uid,
        "siteIds": {k: sorted(v) for k, v in sorted(found.items())},
        "csvCandidates": sorted(set(csv_hits)),
        "pagesVisited": len(seen_pages),
        "siteMeta": site_meta[:50],
    }


def merge_into_offers(report: dict) -> None:
    doc = json.loads(OFFERS_PATH.read_text())
    uid = report["userId"]
    pending = []
    known = {
        "6": "caribbeancom",
        "103": "dxlive",
    }
    for site_id, urls in report["siteIds"].items():
        # prefer Direct eng
        prefer = [u for u in urls if "/Direct/" in u and ("eng" in u or "en/" in u)]
        pick = prefer[0] if prefer else urls[0]
        name = known.get(site_id, f"dti-site-{site_id}")
        if site_id in ("6", "103"):
            continue  # already usable
        pending.append(
            {
                "site": name,
                "siteId": int(site_id) if site_id.isdigit() else site_id,
                "status": "discovered_click_only",
                "usable": False,
                "clickUrl": pick,
                "allUrls": urls[:20],
                "reason": "ClickURL only. Not usable until english landing + clothed creative.",
                "needNext": ["confirm_english_landing", "clothed_creative_sfwVerified"],
            }
        )
    doc["discoveredSites"] = pending
    doc.pop("pendingSites", None)
    doc["lastHarvest"] = {
        "pagesVisited": report["pagesVisited"],
        "csvCandidates": report["csvCandidates"],
        "siteIdCount": len(report["siteIds"]),
    }
    OFFERS_PATH.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n")
    DISCOVERY_PATH.parent.mkdir(parents=True, exist_ok=True)
    DISCOVERY_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(f"wrote {OFFERS_PATH}")
    print(f"wrote {DISCOVERY_PATH}")
    print(f"siteIds found: {list(report['siteIds'])}")
    print(f"csv: {report['csvCandidates']}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cookies-file", type=Path, default=None)
    args = ap.parse_args()
    uid, pw = load_env_password()
    if not uid:
        print("ADULT_EN_DTI_USER_ID がありません", file=sys.stderr)
        sys.exit(1)
    if args.cookies_file:
        # cookie path kept for compatibility; prefer full playwright harvest when password exists
        if pw:
            report = harvest_with_playwright(uid, pw)
        else:
            session = session_from_cookies(args.cookies_file)
            print("using cookies file only is limited; password harvest preferred")
            report = {
                "userId": uid,
                "siteIds": {},
                "csvCandidates": [],
                "pagesVisited": 0,
                "siteMeta": [],
            }
    elif pw:
        report = harvest_with_playwright(uid, pw)
    else:
        print(
            "認証がありません。次のどちらか:\n"
            "  1) .env に ADULT_EN_DTI_PASSWORD を1回だけ書く\n"
            "  2) ブラウザでDTIログイン後、cookieを --cookies-file で渡す\n"
            "ログイン画面メモ: 広告素材に CSVデータダウンロードあり。",
            file=sys.stderr,
        )
        sys.exit(2)
    merge_into_offers(report)


if __name__ == "__main__":
    main()
