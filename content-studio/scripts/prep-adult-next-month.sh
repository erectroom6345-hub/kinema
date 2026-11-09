#!/bin/zsh
# Month-end prep for adult-en / adult-jp X schedule packs (both locales).
# - EN: DTI harvest (if creds) + Carib/Premium deep-link expand inside generator
# - JP: inventory check vs search-query dig list (sfw still needs eye check)
# - Generate next month packs (same-month unique URL hard; prefer prev month)
# - Shortage report + optional notify
#
# Usage:
#   ./scripts/prep-adult-next-month.sh
#   ./scripts/prep-adult-next-month.sh --year 2026 --month 12
#   DRY_RUN=1 ./scripts/prep-adult-next-month.sh
# launchd: run-adult-month-prep.sh → 毎月27–29日 10:00（30–31予約前）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

YEAR=""
MONTH=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --year) YEAR="$2"; shift 2 ;;
    --month) MONTH="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# default = next calendar month (JST-ish: local date)
if [[ -z "$YEAR" || -z "$MONTH" ]]; then
  NEXT="$(python3 - <<'PY'
from datetime import date
t = date.today()
if t.month == 12:
    print(t.year + 1, 1)
else:
    print(t.year, t.month + 1)
PY
)"
  YEAR="${NEXT%% *}"
  MONTH="${NEXT##* }"
fi

echo "[adult-prep] target=${YEAR}-$(printf '%02d' "$MONTH") (EN+JP month-end)"

# Previous month's working sheets + selection scratch. Keep adult-sfw-bank (source stills).
wipe_old_adult_output() {
  echo "[adult-prep] wipe previous schedule sheets and probe scratch"
  local out="$ROOT/output"
  setopt local_options null_glob
  rm -rf \
    "$out/adult-en/teasers" \
    "$out/adult-en/teasers-dups" \
    "$out/adult-jp/teasers" \
    "$out/adult-jp/teasers-dups" \
    "$out/_gate2_probe" \
    "$out"/_bak-* \
    "$out"/_verify-*
  rm -f \
    "$out"/adult-en/x-schedule-pack.* \
    "$out"/adult-jp/x-schedule-pack.* \
    "$out"/adult-schedule-*.html
}

if [[ "${DRY_RUN:-0}" != "1" ]]; then
  wipe_old_adult_output

  if [[ -f .env ]]; then
    # shellcheck disable=SC1091
    set -a
    source .env
    set +a
  fi

  echo "[adult-prep][EN] DTI harvest…"
  if [[ -n "${ADULT_EN_DTI_USER_ID:-}" && -n "${ADULT_EN_DTI_PASSWORD:-}" ]]; then
    python3 scripts/harvest-dti-offers.py || echo "[adult-prep][EN] WARN harvest failed (continue with existing offers)"
  else
    echo "[adult-prep][EN] skip DTI login harvest (no ADULT_EN_DTI_*); deep-link expand still runs in generator"
  fi

  echo "[adult-prep][JP] inventory dig checklist…"
  ADULT_PREP_ROOT="$ROOT" ADULT_PREP_YEAR="$YEAR" ADULT_PREP_MONTH="$MONTH" python3 - <<'PY'
import json, os
from calendar import monthrange
from pathlib import Path
ROOT = Path(os.environ["ADULT_PREP_ROOT"])
year, month = int(os.environ["ADULT_PREP_YEAR"]), int(os.environ["ADULT_PREP_MONTH"])
days = monthrange(year, month)[1]
cat = json.loads((ROOT / "input/products-adult-jp.json").read_text())
usable = [
    p for p in cat["main"]
    if p.get("status") == "usable" and p.get("sfwVerified") and p.get("creativeLocal") and p.get("dmmUrl")
]
parked = [
    p for p in cat["main"]
    if p.get("status") in ("parked_occupation_cosplay", "parked", "candidate")
    and p.get("sfwVerified") and p.get("creativeLocal") and p.get("dmmUrl")
]
urls = {p["dmmUrl"] for p in usable} | {p["dmmUrl"] for p in parked}
print(f"[adult-prep][JP] usable={len(usable)} parkedSFW={len(parked)} uniqueUrl={len(urls)} need>={days} gap={max(0, days-len(urls))}")
qpath = ROOT / "input/adult-jp-search-queries.json"
if qpath.exists() and len(urls) < days:
    qs = json.loads(qpath.read_text()).get("queries") or []
    print("[adult-prep][JP] dig with search queries (着衣目視→usable):")
    for q in qs[:8]:
        print(f"  - {q.get('q')}  ({q.get('angle')})")
    print("[adult-prep][JP] NOTE: pack uses parked/cross-category; add sfwVerified for true zero-gap")
elif len(urls) >= days:
    print("[adult-prep][JP] inventory OK for next month day count")
PY

  echo "[adult-prep] generate EN+JP packs (EN deep-link expand inside)…"
  python3 scripts/generate-adult-month-packs.py --year "$YEAR" --month "$MONTH"
else
  echo "[adult-prep] DRY_RUN=1 → skip harvest/generate"
fi

ADULT_PREP_ROOT="$ROOT" ADULT_PREP_YEAR="$YEAR" ADULT_PREP_MONTH="$MONTH" python3 - <<'PY'
import json, os
from calendar import monthrange
from pathlib import Path
ROOT = Path(os.environ["ADULT_PREP_ROOT"])
year, month = int(os.environ["ADULT_PREP_YEAR"]), int(os.environ["ADULT_PREP_MONTH"])
days = monthrange(year, month)[1]

offers = json.loads((ROOT / "input/affiliate-offers-adult-en.json").read_text())["offers"]
en_usable = [o for o in offers if o.get("status") == "usable" and o.get("sfwVerified") is True]
en_urls = {o["clickUrl"] for o in en_usable if o.get("clickUrl")}

cat = json.loads((ROOT / "input/products-adult-jp.json").read_text())
jp_usable = [
    p for p in cat["main"]
    if p.get("status") == "usable" and p.get("sfwVerified") and p.get("creativeLocal") and p.get("dmmUrl")
]
jp_parked = [
    p for p in cat["main"]
    if p.get("status") in ("parked_occupation_cosplay", "parked", "candidate")
    and p.get("sfwVerified") and p.get("creativeLocal") and p.get("dmmUrl")
]
jp_urls = {p["dmmUrl"] for p in jp_usable} | {p["dmmUrl"] for p in jp_parked}

en_pack = ROOT / "output/adult-en/x-schedule-pack.json"
jp_pack = ROOT / "output/adult-jp/x-schedule-pack.json"
en_posts = json.loads(en_pack.read_text())["posts"] if en_pack.exists() else []
jp_posts = json.loads(jp_pack.read_text())["posts"] if jp_pack.exists() else []

print("--- inventory ---")
print(f"month days: {days}")
print(f"EN unique clickUrl (usable+sfw): {len(en_urls)}  need>={days}  gap={max(0, days-len(en_urls))}")
print(f"JP unique dmmUrl (usable+parkedSFW): {len(jp_urls)}  need>={days}  gap={max(0, days-len(jp_urls))}")
print(f"EN pack posts: {len(en_posts)}  missing={max(0, days-len(en_posts))}")
print(f"JP pack posts: {len(jp_posts)}  missing={max(0, days-len(jp_posts))}")
print("rule: same-month unique HARD; prefer prev-month; EN+JP month-end auto prep")
en_gap = max(0, days - len(en_posts))
jp_gap = max(0, days - len(jp_posts))
if en_gap or jp_gap:
    print(f"WARN: holes EN_missing={en_gap} JP_missing={jp_gap}")
    print("ACTION EN: more DTI/deep links")
    print("ACTION JP: dig input/adult-jp-search-queries.json → sfwVerified usable")
elif len(en_urls) < days or len(jp_urls) < days:
    print("OK pack full this run, but inventory < days — dig before next cycle")
else:
    print("OK: zero-gap with unique-in-month URLs only")
PY

# optional notify hook (no-op if missing)
if [[ -f scripts/lib/notify.sh ]]; then
  # shellcheck disable=SC1091
  source scripts/lib/notify.sh
  if typeset -f notify_text >/dev/null 2>&1; then
    notify_text "adult-prep ${YEAR}-$(printf '%02d' "$MONTH") EN+JP done. Check adult-month-prep.log for gaps." || true
  fi
fi

echo "[adult-prep] done → output/adult-en|jp/x-schedule-pack.copy.html"
