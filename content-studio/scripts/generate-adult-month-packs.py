#!/usr/bin/env python3
"""Generate adult-en then adult-jp monthly schedule packs (csv/json/copy.html).

Selection order (both locales):
  1. usable affiliate (approved + locale-correct link)
  2. sfwVerified creative only (never FANZA pl.jpg fallback)
  3. same-month unique affiliate URL (EN=clickUrl, JP=dmmUrl) — never reuse in the month
  4. weekday category is copy flavor only — never forces a blocked product
  5. zero-gap aim: fill every day without same-month affiliate URL reuse
     - EN: auto-expand Caribbeancom movie deep links when unique URLs short
     - EN liveChat: if live URLs exhausted → video fill (beautyForeign copy)
     - JP: category pool empty → any unused usable → parked
     - Prefer offers that appeared in the previous month's pack (cross-month OK)
     - NEVER reuse the same clickUrl/dmmUrl twice inside one calendar month
       (X schedule can reject same-month duplicate affiliate links)
     - still short after expand → leave gap + WARN (pack still written; --strict fails)

Usage:
  python3 scripts/generate-adult-month-packs.py
  python3 scripts/generate-adult-month-packs.py --year 2026 --month 12 --start-day 3
  python3 scripts/generate-adult-month-packs.py --strict
"""
from __future__ import annotations

import argparse
import csv
import html
import json
import re
import shutil
import ssl
import urllib.error
import urllib.request
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OFFERS_PATH = ROOT / "input/affiliate-offers-adult-en.json"
JP_CATALOG_PATH = ROOT / "input/products-adult-jp.json"

EN_WEEKLY = {
    0: "oho",
    1: "ahegao",
    2: "beautyForeign",
    3: "cosplay",
    4: "oho",
    5: "liveChat",
    6: "beautyJp",
}
# JP weekday = copy flavor. Thu is maniac (oho↔ahegao). Align with policy/adult-jp-ops.json.
JP_WEEKLY = {
    0: "debut",  # mon ~ amateur/debut angle
    1: "snsTalk",  # tue
    2: "beauty",  # wed
    3: "maniac",  # thu — resolved to oho/ahegao in build_jp
    4: "debut",  # fri
    5: "snsTalk",  # sat ~ girlfriendReal soft
    6: "famous",  # sun flex
}

CARIB_SFW = [
    (
        "https://www.caribbeancom.com/eng/images/entrance/asakura.jpg",
        "output/adult-sfw-bank/en/carib_asakura.jpg",
    ),
    (
        "https://www.caribbeancom.com/eng/images/entrance/maeda.jpg",
        "output/adult-sfw-bank/en/carib_maeda.jpg",
    ),
    (
        "https://www.caribbeancom.com/eng/images/entrance/ohashi.jpg",
        "output/adult-sfw-bank/en/carib_ohashi.jpg",
    ),
    (
        "https://www.caribbeancom.com/eng/images/entrance/uehara.jpg",
        "output/adult-sfw-bank/en/carib_uehara.jpg",
    ),
    (
        "https://www.caribbeancom.com/eng/images/entrance/sena.jpg",
        "output/adult-sfw-bank/en/carib_sena.jpg",
    ),
    (
        "https://www.caribbeancom.com/eng/images/entrance/onoue.jpg",
        "output/adult-sfw-bank/en/carib_onoue.jpg",
    ),
]

UA = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
}


def month_dates(year: int, month: int, start_day: int | None = None) -> list[date]:
    d = date(year, month, start_day or 1)
    if month == 12:
        last = date(year + 1, 1, 1) - timedelta(days=1)
    else:
        last = date(year, month + 1, 1) - timedelta(days=1)
    out = []
    while d <= last:
        out.append(d)
        d += timedelta(days=1)
    return out


def en_copy(cat: str, offer: dict) -> str:
    name = offer.get("displayName") or "her"
    url = offer["clickUrl"]
    if cat == "liveChat" or offer.get("productType") == "live":
        return f"Opened live. She was already on.\nDidn’t leave.\n\n{url}\n#ad 18+"
    if cat == "oho":
        return f"Voice alone got me.\n{name} — that intense oho, didn’t need the screen.\n\n{url}\n#ad 18+"
    if cat == "ahegao":
        return f"That face is addictive.\n{name} — eyes gone, rewound just for the melt.\n\n{url}\n#ad 18+"
    if cat == "beautyForeign":
        return f"That look hit first.\n{name} — couldn’t look away.\n\n{url}\n#ad 18+"
    if cat == "beautyJp":
        return f"JP beauty lane.\n{name} — the face did the work.\n\n{url}\n#ad 18+"
    if cat == "cosplay":
        return f"That costume moment.\n{name} — outfit on, brain off.\n\n{url}\n#ad 18+"
    return f"{name}\n\n{url}\n#ad 18+"


def jp_copy(cat: str, product: dict) -> str:
    name = product.get("name") or "この子"
    url = product["dmmUrl"]
    if cat == "oho":
        return f"声だけで持っていかれた。\n{name}のオホ声、画面見なくても……\n\n{url}\n#ad 18禁"
    if cat == "ahegao":
        return f"その顔クセになる。\n{name}、目が上がった瞬間もう終わり。\n\n{url}\n#ad 18禁"
    if cat == "beauty":
        return f"顔で止まった。\n{name}、美人レーン。他は要らん。\n\n{url}\n#ad 18禁"
    if cat == "debut":
        return f"出たばかりなのに、もう刺さった。\n{name}、第一印象これ。\n\n{url}\n#ad 18禁"
    if cat == "famous":
        return f"名前知ってる。\n{name}、やっぱり外れない。\n\n{url}\n#ad 18禁"
    if cat == "snsTalk":
        return f"TLで見かける名前。\n{name}、気になって開いた。\n\n{url}\n#ad 18禁"
    return f"{name}\n\n{url}\n#ad 18禁"


def ensure_local_creative(src_rel: str, dest: Path) -> None:
    src = ROOT / src_rel
    if not src.exists():
        raise FileNotFoundError(f"SFW creative missing: {src}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(src, dest)


def write_html(path: Path, genre: str, posts: list[dict], hour: str, blurb: str) -> None:
    label = "海外版" if genre == "adult-en" else "日本版"
    rows = []
    for row in posts:
        img_rel = ""
        local = row.get("image_local") or ""
        if local:
            img_rel = Path(local).name
            parent = Path(local).parent.name
            if parent:
                img_rel = f"{parent}/{img_rel}"
        rows.append(
            f"""
  <div class="row">
    <div class="meta">{html.escape(f"{row['date']} {row['time']} · {row['category']} · {row['product_id']} · {row['status']}")}</div>
    <pre>{html.escape(row['text'])}</pre>
    {"<img class='teaser' alt='' src='" + html.escape(img_rel) + "' />" if img_rel else ""}
    <div class="actions">
      <button type="button" onclick="copyText(this)">Copy本文</button>
      <button type="button" onclick="copyImage(this)">Copy画像</button>
    </div>
    <div class="path">image: {html.escape(row['image_local'] or '(no image)')}</div>
  </div>"""
        )
    rng = f"{posts[0]['date']}〜{posts[-1]['date']}" if posts else ""
    path.write_text(
        f"""<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8" />
<title>{genre} schedule</title>
<style>
:root{{--bg:#111;--card:#1c1c1c;--text:#f2f2f2;--muted:#9a9a9a;--accent:#2f6fed;--ok:#1f8f4e}}
body{{margin:0;font:15px/1.45 -apple-system,sans-serif;background:var(--bg);color:var(--text);padding:24px}}
.row{{background:var(--card);border-radius:12px;padding:16px;margin:0 0 14px}}
.meta{{color:var(--muted);font-size:13px;margin-bottom:10px}}
pre{{white-space:pre-wrap;background:#0a0a0a;border-radius:8px;padding:12px;margin:0 0 12px}}
img.teaser{{display:block;max-width:280px;border-radius:8px;margin:0 0 12px}}
.actions{{display:flex;gap:8px}}
button{{border:0;border-radius:8px;padding:10px 14px;background:var(--accent);color:#fff;font-weight:600;cursor:pointer}}
button.copied{{background:var(--ok)}}
.path{{font-size:12px;color:var(--muted);margin-top:6px}}
</style></head><body>
<h1>{label} {rng}（{len(posts)}本）</h1>
<p style="color:#9a9a9a">{html.escape(blurb)}</p>
<p style="color:#9a9a9a">http://127.0.0.1:8765 で開く。Copy画像 → Xに貼る → Copy本文 → 貼る → 予約 {hour} JST。file:// では画像コピー不可。</p>
{''.join(rows)}
<script>
async function mark(btn, label){{
  const prev=btn.textContent;
  btn.textContent='Copied';btn.classList.add('copied');
  setTimeout(()=>{{btn.textContent=label;btn.classList.remove('copied')}},1500);
}}
async function copyText(btn){{
  const text=btn.closest('.row').querySelector('pre').innerText;
  try{{await navigator.clipboard.writeText(text);mark(btn,'Copy本文')}}
  catch(e){{alert('本文コピー失敗')}}
}}
async function copyImage(btn){{
  if(!window.isSecureContext){{alert('画像コピーは http://127.0.0.1:8765 で開いたときだけ動く');return}}
  const img=btn.closest('.row').querySelector('img.teaser');
  if(!img||!img.naturalWidth){{alert('画像が読み込めていない');return}}
  try{{
    const canvas=document.createElement('canvas');
    canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
    canvas.getContext('2d').drawImage(img,0,0);
    const blob=await new Promise((res,rej)=>canvas.toBlob(b=>b?res(b):rej(new Error('toBlob')),'image/png'));
    await navigator.clipboard.write([new ClipboardItem({{'image/png':blob}})]);
    mark(btn,'Copy画像');
  }}catch(e){{alert('画像コピー失敗: '+e.message)}}
}}
</script></body></html>
"""
    )


def write_pack(genre: str, posts: list[dict], hour: str, meta: dict, blurb: str) -> None:
    out = ROOT / "output" / genre
    out.mkdir(parents=True, exist_ok=True)
    # Drop prior-month leftovers in this folder before writing the new pack.
    for extra in out.glob("x-schedule-pack.dups.*"):
        extra.unlink()
    oneclick = out / "x-schedule-pack.oneclick-all.json"
    if oneclick.exists():
        oneclick.unlink()
    for folder_name in ("teasers", "teasers-dups"):
        folder = out / folder_name
        if folder.exists():
            for p in folder.glob("*"):
                if p.is_file():
                    p.unlink()
            if folder_name == "teasers-dups":
                folder.rmdir()
    teasers = out / "teasers"
    teasers.mkdir(parents=True, exist_ok=True)

    for row in posts:
        src = row.pop("_src")
        ensure_local_creative(src, ROOT / row["image_local"])

    cols = [
        "date",
        "time",
        "category",
        "product_id",
        "text",
        "dmm_url",
        "image_url",
        "image_local",
        "status",
        "notes",
    ]
    with (out / "x-schedule-pack.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows([{k: r.get(k, "") for k in cols} for r in posts])

    pack = {
        "version": 7,
        "genre": genre,
        "timezone": "Asia/Tokyo",
        "month": posts[0]["date"][:7] if posts else "",
        "range": {
            "start": posts[0]["date"] if posts else "",
            "end": posts[-1]["date"] if posts else "",
        },
        "selectionPriority": [
            "usableAffiliate",
            "sfwCreative",
            "sameMonthUniqueUrl",
            "zeroGapFill",
            "categoryIsCopyOnly",
        ],
        "meta": meta,
        "posts": posts,
    }
    (out / "x-schedule-pack.json").write_text(json.dumps(pack, ensure_ascii=False, indent=2) + "\n")
    write_html(out / "x-schedule-pack.copy.html", genre, posts, hour, blurb)
    print(f"wrote {genre}: {len(posts)} posts -> {out}")


def pick_unique(
    pool: list[dict],
    used_ids: set[str],
    used_urls: set[str],
    *,
    id_key: str = "id",
    url_key: str = "clickUrl",
) -> dict | None:
    """Pick first offer in pool whose id AND affiliate URL are free this month."""
    for p in pool:
        pid = p.get(id_key) or ""
        url = p.get(url_key) or ""
        if not pid or not url:
            continue
        if pid in used_ids or url in used_urls:
            continue
        used_ids.add(pid)
        used_urls.add(url)
        return p
    return None


def is_entrance_click(url: str) -> bool:
    """Caribbeancom (etc.) site entrance — not a title Direct."""
    u = (url or "").lower()
    return "index2.htm" in u or u.rstrip("/").endswith("/eng")


def is_deep_direct(url: str) -> bool:
    """DTI Direct to a specific movie page."""
    return "moviepages" in (url or "").lower()


def prefer_deep_direct(pool: list[dict], url_key: str = "clickUrl") -> list[dict]:
    """Schedule order: moviepages Direct → other non-entrance → entrance last (avoid)."""
    deep, mid, entrance = [], [], []
    for o in pool:
        url = o.get(url_key) or ""
        if is_deep_direct(url):
            deep.append(o)
        elif is_entrance_click(url):
            entrance.append(o)
        else:
            mid.append(o)
    return deep + mid + entrance


def video_pool_for_schedule(video: list[dict]) -> list[dict]:
    """Drop site-entrance clicks from the schedule pool (keep for live face SFW only)."""
    return [o for o in video if not is_entrance_click(o.get("clickUrl") or "")]


def _http_get(url: str, timeout: int = 25) -> bytes:
    ctx = ssl.create_default_context()
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as res:
        return res.read()


def _direct_ok(mid: str) -> bool:
    """True if Caribbeancom Direct deep link redirects (affiliate alive)."""
    ctx = ssl.create_default_context()

    class NoRedir(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[no-untyped-def]
            raise urllib.error.HTTPError(newurl, code, msg, headers, fp)

    opener = urllib.request.build_opener(NoRedir, urllib.request.HTTPSHandler(context=ctx))
    u = f"https://click.dtiserv2.com/Direct/1-6-240932/moviepages/{mid}/index.html"
    req = urllib.request.Request(u, headers=UA)
    try:
        opener.open(req, timeout=12)
        return True
    except urllib.error.HTTPError as e:
        return e.code in (301, 302, 303, 307, 308)
    except Exception:
        return False


def _movie_page_exists(mid: str) -> bool:
    """True if Caribbeancom hosts this movie page (avoids inventing dead deep links)."""
    for url in (
        f"https://www.caribbeancom.com/moviepages/{mid}/index.html",
        f"https://www.caribbeancom.com/eng/moviepages/{mid}/index.html",
    ):
        try:
            _http_get(url, timeout=12)
            return True
        except urllib.error.HTTPError as e:
            if e.code == 404:
                continue
            # 403/5xx: unknown — don't treat as exists
            continue
        except Exception:
            continue
    return False


def load_carib_seed_ids() -> list[str]:
    path = ROOT / "input/adult-en-carib-movie-id-seed.json"
    if not path.exists():
        return []
    try:
        doc = json.loads(path.read_text())
        return [str(x) for x in (doc.get("movieIds") or []) if x]
    except Exception as e:
        print(f"[en-expand] seed read fail: {e}")
        return []


def harvest_carib_movie_ids(limit: int = 80) -> list[str]:
    """Pull movie ids: live list → seed file → optional page probe."""
    found: list[str] = []
    seen: set[str] = set()

    def add(mid: str) -> bool:
        if mid in seen:
            return False
        seen.add(mid)
        found.append(mid)
        return len(found) >= limit

    urls = [
        "https://www.caribbeancom.com/listpages/all1.htm",
        "https://www.caribbeancom.com/listpages/all2.htm",
        "https://www.caribbeancom.com/listpages/all3.htm",
        "https://www.caribbeancom.com/eng/index2.htm",
    ]
    for url in urls:
        try:
            raw = _http_get(url)
        except Exception as e:
            print(f"[en-expand] list fetch fail {url}: {e}")
            continue
        text = None
        for enc in ("euc-jp", "utf-8", "shift_jis", "cp932"):
            try:
                text = raw.decode(enc)
                break
            except Exception:
                continue
        if text is None:
            text = raw.decode("utf-8", "replace")
        for mid in re.findall(r"/moviepages/(\d+-\d+)/", text):
            if add(mid):
                return found

    # Offline-friendly: curated seed (known real titles / prior harvest)
    seed = load_carib_seed_ids()
    if seed:
        print(f"[en-expand] using seed ids ({len(seed)})")
        for mid in seed:
            if add(mid):
                return found

    if len(found) >= limit:
        return found

    print("[en-expand] seed thin → probe recent movie pages")
    today = date.today()
    probed = 0
    for days_back in range(0, 90):
        d = today - timedelta(days=days_back)
        mid = f"{d.month:02d}{d.day:02d}{str(d.year)[2:]}-001"
        if mid in seen:
            continue
        probed += 1
        if not _movie_page_exists(mid):
            continue
        print(f"[en-expand] probe hit {mid}")
        if add(mid):
            break
    print(f"[en-expand] probe checked≈{probed} total_candidates={len(found)}")
    return found


def ensure_en_unique_inventory(need: int) -> dict:
    """Grow usable unique clickUrls via Carib movie deep links until >= need.

    Persists new offers into affiliate-offers-adult-en.json.
    Returns expand report.
    """
    doc = json.loads(OFFERS_PATH.read_text())
    offers: list[dict] = doc["offers"]
    usable = [o for o in offers if o.get("status") == "usable" and o.get("sfwVerified") is True]
    urls = {o["clickUrl"] for o in usable if o.get("clickUrl")}
    ids = {o["id"] for o in offers}
    mids = {o.get("movieId") for o in offers if o.get("movieId")}
    report = {"need": need, "before": len(urls), "added": [], "fetchError": None}

    if len(urls) >= need:
        report["after"] = len(urls)
        return report

    want = need - len(urls)
    print(
        f"[en-expand] unique clickUrl {len(urls)} < need {need} "
        f"(want +{want}) → Carib deep-link harvest"
    )
    seed_set = set(load_carib_seed_ids())
    try:
        candidates = harvest_carib_movie_ids(limit=max(want + 20, want * 3))
    except Exception as e:
        report["fetchError"] = str(e)
        candidates = list(seed_set)

    added = 0
    insert_at = len(offers)
    for i, o in enumerate(offers):
        if str(o.get("id", "")).startswith("dti-caribbeancom-movie-"):
            insert_at = i + 1

    for mid in candidates:
        if len(urls) >= need:
            break
        if mid in mids:
            continue
        oid = f"dti-caribbeancom-movie-{mid}"
        click = f"https://click.dtiserv2.com/Direct/1-6-240932/moviepages/{mid}/index.html"
        if oid in ids or click in urls:
            continue
        direct = _direct_ok(mid)
        if not direct and mid not in seed_set:
            continue
        note = "zero-gap auto deep-link. SFW entrance portrait reuse."
        if not direct and mid in seed_set:
            note += " directUnverified(seed)."
            print(f"[en-expand] seed {mid} direct fail/blocked — add anyway")
        cu, cl = CARIB_SFW[added % len(CARIB_SFW)]
        if not (ROOT / cl).exists():
            print(f"[en-expand] skip missing SFW bank {cl}")
            continue
        label = f"Caribbeancom {mid.replace('-001', '')}"
        offer = {
            "id": oid,
            "affiliate": "dti",
            "offer": "caribbeancom",
            "productType": "video",
            "status": "usable",
            "sfwVerified": True,
            "sfwLens": "clothed_portrait_reused",
            "displayName": label,
            "movieId": mid,
            "clickUrl": click,
            "creativeUrl": cu,
            "creativeLocal": cl,
            "categoriesSoft": [
                "popular",
                "beautyJp",
                "beautyForeign",
                "cosplay",
                "oho",
                "ahegao",
            ],
            "notes": note,
        }
        offers.insert(insert_at + added, offer)
        urls.add(click)
        ids.add(oid)
        mids.add(mid)
        report["added"].append(oid)
        added += 1
        print(f"[en-expand] +{oid}")

    if report["added"]:
        notes = list(doc.get("notes") or [])
        note = f"zero-gap auto-expand +{len(report['added'])} carib movie deep links"
        if note not in notes:
            notes.append(note)
        doc["notes"] = notes
        doc["offers"] = offers
        OFFERS_PATH.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n")

    report["after"] = len(urls)
    return report


def missing_dates(dates: list[date], posts: list[dict]) -> list[date]:
    have = {p["date"] for p in posts}
    return [d for d in dates if d.isoformat() not in have]


def prev_month_key(year: int, month: int) -> str:
    if month == 1:
        return f"{year - 1}-12"
    return f"{year}-{month - 1:02d}"


def load_prev_month_url_order(genre: str, year: int, month: int) -> list[str]:
    """URLs from previous calendar month pack (cross-month reuse is OK)."""
    path = ROOT / "output" / genre / "x-schedule-pack.json"
    if not path.exists():
        return []
    try:
        pack = json.loads(path.read_text())
    except Exception:
        return []
    if pack.get("month") != prev_month_key(year, month):
        # Also accept dups / oneclick archives from that month if main was overwritten
        return []
    urls: list[str] = []
    seen: set[str] = set()
    for p in pack.get("posts") or []:
        u = p.get("dmm_url") or ""
        if not u or u in seen:
            continue
        seen.add(u)
        urls.append(u)
    return urls


def prefer_prev_month(pool: list[dict], url_key: str, prev_urls: list[str]) -> list[dict]:
    """Stable-sort pool so last month's affiliate URLs come first (still unique this month)."""
    if not prev_urls:
        return list(pool)
    rank = {u: i for i, u in enumerate(prev_urls)}
    head = [p for p in pool if (p.get(url_key) or "") in rank]
    head.sort(key=lambda p: rank.get(p.get(url_key) or "", 10**9))
    tail = [p for p in pool if (p.get(url_key) or "") not in rank]
    return head + tail


def build_en(dates: list[date], *, year: int, month: int, strict: bool) -> tuple[list[dict], dict]:
    expand = ensure_en_unique_inventory(need=len(dates))
    offers_doc = json.loads(OFFERS_PATH.read_text())
    usable = [
        o
        for o in offers_doc["offers"]
        if o.get("status") == "usable" and o.get("sfwVerified") is True
    ]
    # Catalog mix: monthly one-each sites (thin unique URL), Premium for growth, Carib main.
    monthly_one = ["10musume", "muramura", "pacopacomama"]
    prev_urls = load_prev_month_url_order("adult-en", year, month)
    video_all = prefer_prev_month(
        [o for o in usable if o.get("productType") == "video"], "clickUrl", prev_urls
    )
    # Entrance portraits stay in video_all for live face SFW; schedule from Direct-first pool.
    video = prefer_deep_direct(video_pool_for_schedule(video_all))
    live = prefer_prev_month(
        [o for o in usable if o.get("productType") == "live"], "clickUrl", prev_urls
    )
    used_ids: set[str] = set()
    used_urls: set[str] = set()
    posts: list[dict] = []
    live_to_video: list[str] = []
    monthly_placed: set[str] = set()
    entrance_excluded = sum(
        1 for o in video_all if is_entrance_click(o.get("clickUrl") or "")
    )

    # Place monthly-one sites first on early non-live days (unique URL each).
    slot_days = [d for d in dates if EN_WEEKLY[d.weekday()] != "liveChat"][: len(monthly_one)]
    reserved_dates: dict[str, dict] = {}
    for site, d in zip(monthly_one, slot_days):
        pool = prefer_deep_direct([o for o in video if o.get("offer") == site])
        offer = pick_unique(pool, used_ids, used_urls)
        if offer is None:
            continue
        cat = EN_WEEKLY[d.weekday()]
        reserved_dates[d.isoformat()] = {
            "date": d.isoformat(),
            "time": "12:00",
            "category": cat,
            "product_id": offer["id"],
            "text": en_copy(cat, offer),
            "dmm_url": offer["clickUrl"],
            "image_url": offer.get("creativeUrl", ""),
            "image_local": f"output/adult-en/teasers/{d.isoformat()}_{offer['id']}.jpg",
            "status": "ready",
            "notes": f"monthlyOneEach {site}; SFW {offer.get('sfwLens')}",
            "_src": offer["creativeLocal"],
        }
        monthly_placed.add(site)

    for d in dates:
        if d.isoformat() in reserved_dates:
            posts.append(reserved_dates[d.isoformat()])
            continue
        cat = EN_WEEKLY[d.weekday()]
        if cat == "liveChat":
            live_offer = pick_unique(live, used_ids, used_urls)
            if live_offer is not None:
                face = next(
                    (o for o in video_all if o.get("creativeLocal")),
                    live_offer,
                )
                posts.append(
                    {
                        "date": d.isoformat(),
                        "time": "12:00",
                        "category": "liveChat",
                        "product_id": live_offer["id"],
                        "text": en_copy("liveChat", live_offer),
                        "dmm_url": live_offer["clickUrl"],
                        "image_url": face.get("creativeUrl", ""),
                        "image_local": f"output/adult-en/teasers/{d.isoformat()}_{live_offer['id']}.jpg",
                        "status": "ready",
                        "notes": f"affiliate-first DTI live; SFW face={face.get('id')}",
                        "_src": face.get("creativeLocal") or live_offer.get("creativeLocal"),
                    }
                )
                continue
            # live URL exhausted → video with beautyForeign copy (still unique URL)
            offer = pick_unique(video, used_ids, used_urls)
            if offer is None:
                continue
            live_to_video.append(d.isoformat())
            posts.append(
                {
                    "date": d.isoformat(),
                    "time": "12:00",
                    "category": "beautyForeign",
                    "product_id": offer["id"],
                    "text": en_copy("beautyForeign", offer),
                    "dmm_url": offer["clickUrl"],
                    "image_url": offer.get("creativeUrl", ""),
                    "image_local": f"output/adult-en/teasers/{d.isoformat()}_{offer['id']}.jpg",
                    "status": "ready",
                    "notes": f"zeroGap liveUrlExhausted→video; DTI {offer.get('offer')}; SFW {offer.get('sfwLens')}",
                    "_src": offer["creativeLocal"],
                }
            )
            continue

        soft = [o for o in video if cat in (o.get("categoriesSoft") or [])] or video
        # Prefer Carib/Premium for bulk days; keep monthly-one sites from double-booking via used_urls.
        soft_bulk = prefer_deep_direct(
            [
                o
                for o in soft
                if o.get("offer") not in monthly_one or o.get("offer") in monthly_placed
            ]
            or soft
        )
        offer = pick_unique(soft_bulk, used_ids, used_urls)
        if offer is None and soft_bulk is not video:
            offer = pick_unique(video, used_ids, used_urls)
        if offer is None:
            continue
        note = f"affiliate-first DTI {offer.get('offer')}; SFW {offer.get('sfwLens')}"
        if is_deep_direct(offer.get("clickUrl") or ""):
            note += "; deepDirect"
        if offer.get("offer") == "caribbeancompr":
            note += "; premiumGrow"
        if offer.get("clickUrl") in prev_urls:
            note += "; fromPrevMonth"
        posts.append(
            {
                "date": d.isoformat(),
                "time": "12:00",
                "category": cat,
                "product_id": offer["id"],
                "text": en_copy(cat, offer),
                "dmm_url": offer["clickUrl"],
                "image_url": offer.get("creativeUrl", ""),
                "image_local": f"output/adult-en/teasers/{d.isoformat()}_{offer['id']}.jpg",
                "status": "ready",
                "notes": note,
                "_src": offer["creativeLocal"],
            }
        )

    posts.sort(key=lambda p: p["date"])
    still = [d.isoformat() for d in missing_dates(dates, posts)]
    if still:
        print(
            f"WARN adult-en: {len(still)} day(s) unfilled (no same-month URL reuse). "
            f"Dig more unique DTI links. missing={', '.join(still)}"
        )
    if still and strict:
        raise SystemExit(f"adult-en zero-gap strict failed; missing: {', '.join(still)}")

    meta = {
        "affiliate": "dti",
        "usableOffers": [o["id"] for o in usable],
        "uniqueClickUrls": len({o["clickUrl"] for o in usable}),
        "skippedNoUniqueAffiliate": still,
        "liveChatFilledWithVideo": live_to_video,
        "preferredPrevMonthUrls": len(prev_urls),
        "sameMonthUrlReuse": False,
        "monthlyOneEachPlaced": sorted(monthly_placed),
        "preferDeepDirect": True,
        "entranceClicksExcludedFromSchedule": entrance_excluded,
        "inventoryExpand": expand,
        "zeroGap": len(still) == 0,
        "source": "input/affiliate-offers-adult-en.json",
        "rule": "sameMonthUniqueHard+preferPrevMonth+catalogMixCaribMainPremiumGrowMonthlyOne",
        "catalogMix": {
            "main": "caribbeancom",
            "grow": "caribbeancompr",
            "monthlyOneEach": monthly_one,
        },
    }
    return posts, meta


def build_jp(dates: list[date], *, year: int, month: int, strict: bool) -> tuple[list[dict], dict]:
    catalog = json.loads(JP_CATALOG_PATH.read_text())
    usable = [
        p
        for p in catalog["main"]
        if p.get("status") == "usable"
        and p.get("sfwVerified") is True
        and p.get("creativeLocal")
        and p.get("dmmUrl")
    ]
    parked = [
        p
        for p in catalog["main"]
        if p.get("status") in ("parked_occupation_cosplay", "parked", "candidate")
        and p.get("sfwVerified") is True
        and p.get("creativeLocal")
        and p.get("dmmUrl")
    ]
    if not usable and not parked:
        raise RuntimeError("JP has no usable/parked DMM offers with sfwVerified creative")

    prev_urls = load_prev_month_url_order("adult-jp", year, month)
    usable = prefer_prev_month(usable, "dmmUrl", prev_urls)
    parked = prefer_prev_month(parked, "dmmUrl", prev_urls)

    by_id = {p["id"]: p for p in usable}
    ahe_pool = prefer_prev_month(
        [by_id[i] for i in catalog.get("pools", {}).get("ahegaoUsable", []) if i in by_id],
        "dmmUrl",
        prev_urls,
    )
    oho_fill = prefer_prev_month(
        [by_id[i] for i in catalog.get("pools", {}).get("ahegaoFillFromOho", []) if i in by_id],
        "dmmUrl",
        prev_urls,
    )
    oho_pool = prefer_prev_month(
        [p for p in usable if p.get("category") == "oho"], "dmmUrl", prev_urls
    )
    if not ahe_pool:
        ahe_pool = prefer_prev_month(
            [p for p in usable if p.get("category") == "ahegao"], "dmmUrl", prev_urls
        )
    if not oho_fill:
        oho_fill = oho_pool

    maniac_thurs = [d for d in dates if d.weekday() == 3]
    maniac_angle_for = {
        d: ("oho" if i % 2 == 0 else "ahegao") for i, d in enumerate(maniac_thurs)
    }

    used_ids: set[str] = set()
    used_urls: set[str] = set()
    posts: list[dict] = []
    cross_category_fill: list[str] = []
    parked_fill: list[str] = []

    for d in dates:
        flavor = JP_WEEKLY[d.weekday()]
        note_extra = ""
        product = None
        copy_cat = flavor

        if flavor == "maniac":
            angle = maniac_angle_for[d]
            note_extra = f"; maniac={angle}"
            soft = oho_pool if angle == "oho" else (ahe_pool + oho_fill)
            product = pick_unique(soft, used_ids, used_urls, url_key="dmmUrl")
            if product is None:
                product = pick_unique(usable, used_ids, used_urls, url_key="dmmUrl")
                if product is not None:
                    cross_category_fill.append(d.isoformat())
                    note_extra += "; zeroGapCrossCategory"
            if product is None:
                product = pick_unique(parked, used_ids, used_urls, url_key="dmmUrl")
                if product is not None:
                    parked_fill.append(d.isoformat())
                    note_extra += f"; zeroGapParked:{product.get('status')}"
            if product is not None:
                if angle == "ahegao" and product.get("category") != "ahegao":
                    copy_cat = "oho"
                    note_extra += "; ahegaoShortageFillFromOho"
                else:
                    copy_cat = angle if product.get("category") in ("oho", "ahegao") else (
                        product.get("category") or "debut"
                    )
                    if copy_cat not in ("oho", "ahegao", "beauty", "debut", "famous", "snsTalk"):
                        copy_cat = "debut"
        else:
            soft = prefer_prev_month(
                [p for p in usable if p.get("category") == flavor], "dmmUrl", prev_urls
            )
            product = pick_unique(soft, used_ids, used_urls, url_key="dmmUrl")
            if product is None:
                product = pick_unique(usable, used_ids, used_urls, url_key="dmmUrl")
                if product is not None:
                    cross_category_fill.append(d.isoformat())
                    note_extra += "; zeroGapCrossCategory"
                    copy_cat = product.get("category") or flavor
                    if copy_cat not in ("oho", "ahegao", "beauty", "debut", "famous", "snsTalk"):
                        copy_cat = flavor
                else:
                    product = pick_unique(parked, used_ids, used_urls, url_key="dmmUrl")
                    if product is not None:
                        parked_fill.append(d.isoformat())
                        note_extra += f"; zeroGapParked:{product.get('status')}"
                        copy_cat = flavor
            else:
                copy_cat = flavor

        if product is None:
            continue

        if product.get("dmmUrl") in prev_urls:
            note_extra += "; fromPrevMonth"
        posts.append(
            {
                "date": d.isoformat(),
                "time": "21:00",
                "category": copy_cat,
                "product_id": product["id"],
                "text": jp_copy(copy_cat, product),
                "dmm_url": product["dmmUrl"],
                "image_url": product.get("teaserImageUrl") or "",
                "image_local": f"output/adult-jp/teasers/{d.isoformat()}_{product['id']}.jpg",
                "status": "ready",
                "notes": f"affiliate-first DMM; SFW {product.get('sfwLens')}; cid={product.get('cid')}{note_extra}",
                "_src": product["creativeLocal"],
            }
        )

    posts.sort(key=lambda p: p["date"])
    still = [d.isoformat() for d in missing_dates(dates, posts)]
    if still:
        print(
            f"WARN adult-jp: {len(still)} day(s) unfilled (no same-month URL reuse). "
            f"Add search-query digs / sfwVerified. missing={', '.join(still)}"
        )
    if still and strict:
        raise SystemExit(f"adult-jp zero-gap strict failed; missing: {', '.join(still)}")

    meta = {
        "affiliate": "dmm",
        "usableProducts": [p["id"] for p in usable],
        "maniacVoice": catalog.get("pools", {}).get("maniacVoice", []),
        "blockedNoSfw": [
            p["id"] for p in catalog["main"] if p.get("status") == "blocked_no_sfw"
        ],
        "skippedNoUniqueAffiliate": still,
        "crossCategoryFill": cross_category_fill,
        "parkedFill": parked_fill,
        "preferredPrevMonthUrls": len(prev_urls),
        "sameMonthUrlReuse": False,
        "zeroGap": len(still) == 0,
        "source": "input/products-adult-jp.json",
        "postingHourJst": "21:00",
        "enPostingHourJst": "12:00",
        "rule": "sameMonthUniqueHard+preferPrevMonth+noSameMonthReuse",
    }
    return posts, meta


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", type=int, default=2026)
    ap.add_argument("--month", type=int, default=11)
    ap.add_argument("--start-day", type=int, default=None)
    ap.add_argument(
        "--strict",
        action="store_true",
        help="Hard-fail if any day cannot be filled with a unique-in-month URL",
    )
    ap.add_argument(
        "--allow-gaps",
        action="store_true",
        help=argparse.SUPPRESS,
    )
    args = ap.parse_args()
    dates = month_dates(args.year, args.month, args.start_day)

    en_posts, en_meta = build_en(
        dates, year=args.year, month=args.month, strict=args.strict
    )
    jp_posts, jp_meta = build_jp(
        dates, year=args.year, month=args.month, strict=args.strict
    )

    write_pack(
        "adult-en",
        en_posts,
        "12:00",
        en_meta,
        "同月URL一意（硬）。先月分を優先。不足は深リンク拡張。同月再利用はしない。",
    )
    write_pack(
        "adult-jp",
        jp_posts,
        "21:00",
        jp_meta,
        "同月URL一意（硬）。先月分を優先。不足は検索ワード掘りで在庫増。同月再利用はしない。",
    )


if __name__ == "__main__":
    main()
