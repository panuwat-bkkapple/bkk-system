// ---------------------------------------------------------------------------
// CRM Contact identity layer.
//
// A "contact" is a PERSON keyed by phone/email ONLY — never by uid. uid stays
// on the auth / customer-facing side (inbox/{uid} + Firebase rules), completely
// separate. Conversations and orders point at a contact via a one-way
// `crm_customer_id`; the contact record never stores uids.
//
//   crm_contacts/{contactId}          push-id — the person
//     name, address, phones{}, emails{}, verified, created_at, updated_at
//   crm_contact_index/phone/{phoneKey} -> contactId   (O(1) resolve)
//   crm_contact_index/email/{emailKey} -> contactId
//
//   jobs/{id}.crm_customer_id   -> contactId   (pointer, one-way)
//   inbox/{uid}.crm_customer_id -> contactId   (pointer, one-way)
//
// NB: this is a DISTINCT namespace from the legacy `customers` collection
// (CRM page / POS `customers/CUS_{phone}` / admin order picker) — do not write
// there. Side-effect free on require so it deploys safely.
// ---------------------------------------------------------------------------

// Thailand phone normalization. MUST stay identical to bkk-system
// chat-ai.js normalizePhone (guarded by functions/test/crm.test.mjs).
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

// Resolve-or-create the contact for a set of signals; returns the contactId (or
// null when there is no usable phone/email). Auto-attach: an existing match by
// phone (preferred) or email is reused and enriched. The primary-index claim is
// a transaction so two concurrent calls for the same phone cannot create two
// contacts. `db` = admin RTDB root.
async function resolveCustomer(db, { phone, email, name, address } = {}) {
  const pk = phoneKey(phone);
  const ek = emailKey(email);
  if (!pk && !ek) return null;

  // Claim the primary index atomically: phone if we have one, else email.
  const primaryPath = pk ? `crm_contact_index/phone/${pk}` : `crm_contact_index/email/${ek}`;
  const candidateId = db.ref("crm_contacts").push().key; // generated, not written yet
  const tx = await db.ref(primaryPath).transaction((cur) => (cur == null ? candidateId : cur));
  const contactId = tx.snapshot.val();
  const created = contactId === candidateId;
  const now = Date.now();

  if (created) {
    const rec = { created_at: now, updated_at: now, verified: false };
    if (name) rec.name = String(name).slice(0, 120);
    if (address) rec.address = String(address).slice(0, 300);
    if (pk) rec.phones = { [pk]: true };
    if (ek) rec.emails = { [ek]: true };
    await db.ref(`crm_contacts/${contactId}`).set(rec);
  } else {
    const cur = (await db.ref(`crm_contacts/${contactId}`).once("value")).val() || {};
    const upd = { updated_at: now };
    if (pk) upd[`phones/${pk}`] = true;
    if (ek) upd[`emails/${ek}`] = true;
    if (name && !cur.name) upd.name = String(name).slice(0, 120);
    if (address && !cur.address) upd.address = String(address).slice(0, 300);
    await db.ref(`crm_contacts/${contactId}`).update(upd);
  }

  // Point BOTH indexes at this contact (idempotent; also links a newly-seen
  // secondary key of an existing contact).
  const idx = {};
  if (pk) idx[`crm_contact_index/phone/${pk}`] = contactId;
  if (ek) idx[`crm_contact_index/email/${ek}`] = contactId;
  await db.ref().update(idx);

  return contactId;
}

module.exports = { normalizePhone, phoneKey, emailKey, resolveCustomer };
