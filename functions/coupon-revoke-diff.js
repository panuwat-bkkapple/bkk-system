// Which applied_coupons lines LEFT a job between two writes — the one diff
// behind onJobCouponsRevoked.
//
// Keyed by code + device_id, not by code alone. A device-bucket campaign
// ("MacBook +1,000") rides EVERY qualifying device on the order, so one code
// can legitimately appear on two lines (two MacBooks, or a duplicated cart
// row). The old code-only diff read "the code is still on the job" when the
// admin removed just one of the two rides — the ride was gone, the customer's
// total dropped, and the campaign quota / ledger was never given back. Silent,
// no error, and it got much more likely once the cart grew a "add the same
// device again" button (bkk-frontend-next).
//
// Lines from before the bucket work carry no device_id: their key degrades to
// `CODE|` and behaves exactly as the old diff did (one line per code).
//
// Pure — no Firebase. Guard: functions/test/coupon-revoke-diff.test.mjs.

function toList(raw) {
  const list = Array.isArray(raw)
    ? raw
    : (raw && typeof raw === "object" ? Object.values(raw) : []);
  return list.filter(Boolean);
}

function couponLineKey(line) {
  const code = String(line?.code || "").trim().toUpperCase();
  const device = String(line?.device_id || "").trim();
  return `${code}|${device}`;
}

/**
 * Lines present in `before` whose (code, device_id) is no longer in `after`.
 * A line with no code is never "revoked" — there is nothing to give back.
 */
function revokedCouponLines(beforeRaw, afterRaw) {
  const before = toList(beforeRaw);
  const after = toList(afterRaw);
  if (before.length === 0) return [];
  const stillThere = new Set(after.map(couponLineKey));
  return before.filter((line) => {
    const key = couponLineKey(line);
    if (key.startsWith("|")) return false;
    return !stillThere.has(key);
  });
}

module.exports = { revokedCouponLines, couponLineKey, toList };
