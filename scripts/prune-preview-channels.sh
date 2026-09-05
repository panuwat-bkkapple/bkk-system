#!/usr/bin/env bash
# ตัดช่อง preview เก่าของ Hosting site หนึ่งก่อนสร้างช่องใหม่
#
# Firebase Hosting จำกัดช่อง preview ไว้ที่ ~50 ช่อง **ต่อ site** เกินแล้ว
# การ deploy จะล้มด้วย HTTP 429 RESOURCE_EXHAUSTED (เคยกัด PR #328 มาแล้ว)
# `expires: 1d` ช่วยย่นอายุแต่ละช่อง แต่ PR ที่เข้ามาถี่ๆ ยังกองได้เร็วกว่า
# ที่มันหมดอายุ และช่องที่หมดอายุแล้วแต่ยังไม่ถูก GC ก็ยังนับรวมในเพดาน
# การเก็บเฉพาะ N ช่องใหม่สุดจึงล็อกจำนวนไว้ไม่ให้เข้าใกล้โควตา
#
# **เป็นไฟล์เดียวใช้ทั้งสอง job โดยตั้งใจ** — เพดานนี้เป็นของทุก site ถ้าก๊อป
# บล็อกนี้ไปวางในแต่ละ job สองสำเนาจะ drift กัน แล้ววันหนึ่ง site ที่ถูกลืมจะ
# ตัน 429 เงียบๆ (กฎ mirror ของ CLAUDE.md)
#
# ต้องตั้ง: SITE (ชื่อ Hosting site) · FIREBASE_SERVICE_ACCOUNT (JSON)
# ไม่บังคับ: PROJECT_ID (ค่าตั้งต้น bkk-apple-tradein) · KEEP (ค่าตั้งต้น 20)
set -u

SITE="${SITE:?ต้องระบุ SITE}"
PROJECT_ID="${PROJECT_ID:-bkk-apple-tradein}"
KEEP="${KEEP:-20}"
TMP="${RUNNER_TEMP:-/tmp}"

printf '%s' "${FIREBASE_SERVICE_ACCOUNT:?ต้องระบุ FIREBASE_SERVICE_ACCOUNT}" > "$TMP/prune-sa.json"
export GOOGLE_APPLICATION_CREDENTIALS="$TMP/prune-sa.json"
npm install -g firebase-tools@13 >/dev/null 2>&1

# `--json` ห่อผลลัพธ์เป็น { status, result } และ result เป็นได้ทั้ง array ของ
# channel และ { channels: [...] } แล้วแต่เวอร์ชัน CLI จึงรับทั้งสองรูป
# เรียงตาม expireTime มากไปน้อย (ตัวใหม่สุดอยู่หน้า) แล้วลบทุกตัวหลังจาก KEEP
# ช่องที่ไม่มีวันหมดอายุจะถูกจัดไปท้ายสุดและโดนลบก่อน — ตั้งใจ
channels=$(firebase hosting:channel:list \
  --site "$SITE" --project "$PROJECT_ID" --json 2>/dev/null || echo '{}')
echo "$channels" \
  | jq -r --argjson keep "$KEEP" '
      (.result.channels // .result // [])
      | map(select(.name != null))
      | sort_by(.expireTime) | reverse
      | .[$keep:]
      | .[].name' \
  | sed 's#.*/channels/##' \
  | while read -r ch; do
      [ -z "$ch" ] && continue
      [ "$ch" = "live" ] && continue
      echo "Deleting stale preview channel on $SITE: $ch"
      firebase hosting:channel:delete "$ch" \
        --site "$SITE" --project "$PROJECT_ID" --force >/dev/null 2>&1 || true
    done

rm -f "$TMP/prune-sa.json"
