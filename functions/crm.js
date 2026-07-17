// ---------------------------------------------------------------------------
// CRM Contact identity layer — Phase 1 (dormant foundation).
//
// A "customer" is a PERSON keyed by phone/email ONLY — never by uid. uid stays
// on the auth / customer-facing side (inbox/{uid} + Firebase rules), completely
// separate. Conversations and orders point at a customer via a one-way
// `customer_id`; the customer record never stores uids.
//
//   customers/{customerId}            push-id — the person
//     name, address, phones{}, emails{}, verified, created_at, updated_at
//   customer_index/phone/{phoneKey}   -> customerId   (O(1) resolve)
//   customer_index/email/{emailKey}   -> customerId
//
//   jobs/{id}.customer_id   -> customerId   (pointer, one-way)
//   inbox/{uid}.customer_id -> customerId   (pointer, one-way)
//
// NOT wired into any live path yet. Phase 2 calls resolveCustomer() from
// save_customer_info + admin order creation + checkout; Phase 3 switches the
// admin reads to customer_id. Side-effect free on require so it deploys safely.
// ---------------------------------------------------------------------------

// Thailand phone normalization. MUST stay identical to bkk-system
// chat-ai.js normalizePhone (guarded by functions/test/crm.test.mjs) — Phase 2
// collapses both into this single source.
function normalizePhone(raw) {
  if (!raw) return "";
  let p = String(raw).replace(/[\s\-().]/g, "");
  if (p.startsWith("+66")) p = "0" + p.slice(3);
  else if (p.startsWith("66") && p.length >= 11) p = "0" + p.slice(2);
  return p;
}

// RTDB keys cannot contain . $ # [ ] / — phone (digits) is safe; email must be
// sanitized. Deterministic so the same contact always maps to the same key.
// Returns "" for junk so we never index garbage.
function phoneKey(raw) {
  const p = normalizePhone(raw);
  return /^\d{6,}$/.test(p) ? p : "";
}

function emailKey(raw) {
  const e = String(raw || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return "";
  return e.replace(/[.#$[\]/]/g, ","); // "." is illegal in RTDB keys -> ","
}

// Resolve-or-create the customer for a set of contact signals; returns the
// customerId (or null when there is no usable phone/email). Auto-attach: an
// existing match by phone (preferred) or email is reused and enriched. The
// primary-index claim is a transaction so two concurrent calls for the same
// phone cannot create two contacts. `db` = admin RTDB root.
async function resolveCustomer(db, { phone, email, name, address } = {}) {
  const pk = phoneKey(phone);
  const ek = emailKey(email);
  if (!pk && !ek) return null;

  // Claim the primary index atomically: phone if we have one, else email.
  const primaryPath = pk ? `customer_index/phone/${pk}` : `customer_index/email/${ek}`;
  const candidateId = db.ref("customers").push().key; // generated, not written yet
  const tx = await db.ref(primaryPath).transaction((cur) => (cur == null ? candidateId : cur));
  const customerId = tx.snapshot.val();
  const created = customerId === candidateId;
  const now = Date.now();

  if (created) {
    const rec = { created_at: now, updated_at: now, verified: false };
    if (name) rec.name = String(name).slice(0, 120);
    if (address) rec.address = String(address).slice(0, 300);
    if (pk) rec.phones = { [pk]: true };
    if (ek) rec.emails = { [ek]: true };
    await db.ref(`customers/${customerId}`).set(rec);
  } else {
    const cur = (await db.ref(`customers/${customerId}`).once("value")).val() || {};
    const upd = { updated_at: now };
    if (pk) upd[`phones/${pk}`] = true;
    if (ek) upd[`emails/${ek}`] = true;
    if (name && !cur.name) upd.name = String(name).slice(0, 120);
    if (address && !cur.address) upd.address = String(address).slice(0, 300);
    await db.ref(`customers/${customerId}`).update(upd);
  }

  // Point BOTH indexes at this contact (idempotent; also links a newly-seen
  // secondary key of an existing contact).
  const idx = {};
  if (pk) idx[`customer_index/phone/${pk}`] = customerId;
  if (ek) idx[`customer_index/email/${ek}`] = customerId;
  await db.ref().update(idx);

  return customerId;
}

module.exports = { normalizePhone, phoneKey, emailKey, resolveCustomer };
