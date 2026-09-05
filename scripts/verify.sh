#!/usr/bin/env bash
# รันด่านชุดเดียวกับ CI ในเครื่อง — **มีไว้เพราะการรัน "ทีละอย่างตามที่จำได้" พลาดมาแล้ว**
#
# เคสจริง 5 ก.ย. 2569 (PR #730): ตรวจด้วย `npx tsc -b` ที่ root แล้ว `npx vite build`
# ใน employee-app/ แล้วรายงานว่าเขียว — **ทั้งสองคำสั่งไม่ตรวจ type ของแอปพนักงานเลย**
#   · `tsc -b` ที่ root อ่าน tsconfig ของ root ซึ่งไม่ได้ reference employee-app
#   · `npx vite build` ข้าม tsc (สคริปต์จริงคือ `tsc -b && vite build`)
# CI จับได้สองข้อในนาทีเดียว ทั้งที่ในเครื่องเขียวสนิท
#
# ความรู้ข้อนี้เขียนไว้แล้วใน `.github/workflows/ci.yml` ("`npx tsc -b` ของ root
# มองไม่เห็นมันเลย") แต่ไฟล์นั้นไม่ใช่ที่ที่คนเปิดอ่านตอนกำลังตรวจงานก่อน push
# — **เอกสารที่เตือนไว้แล้วช่วยไม่ได้ ถ้าไม่ได้เปิดอ่านตอนนั้น** จึงย้ายมาเป็น
# คำสั่งเดียวที่รันได้ แทนที่จะเป็นเช็คลิสต์ที่ต้องจำ
#
# ใช้: npm run verify
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n\033[1m── %s\033[0m\n' "$1"; }

step "tsc -b (แอปแอดมิน + ไฟล์ฝั่ง node)"
npx tsc -b

step "สถานะงานที่ generate ไว้ยังตรงกับ enum"
npm run check:status-vocab

step "เทสทั้งรีโป (รวมเทสของ employee-app — vite.config include ไว้)"
REQUIRE_PRINT_CHECKS=1 npm test

step "build แอปพนักงาน (tsc ของมันเอง + vite)"
# ต้องเป็น `npm run build` ไม่ใช่ `npx vite build` — ตัวหลังข้าม tsc
( cd employee-app && npm run build )

step "เทสออฟไลน์ของ Cloud Functions"
fail=0
for f in functions/test/*.test.mjs; do
  node "$f" >/dev/null 2>&1 || { echo "  ✗ $f"; fail=1; }
done
[ "$fail" -eq 0 ] || { echo "เทสของ functions ไม่ผ่าน"; exit 1; }
echo "  ผ่านครบ $(ls functions/test/*.test.mjs | wc -l | tr -d ' ') ไฟล์"

step "syntax ของ functions"
for f in functions/*.js; do node --check "$f"; done
echo "  ผ่าน"

printf '\n\033[32mผ่านทุกด่านที่ CI รัน\033[0m\n'
