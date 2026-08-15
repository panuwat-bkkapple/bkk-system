/**
 * Store facts — the things about THIS SHOP that are true regardless of who is
 * asking, and nothing else.
 *
 * Extracted from chat-ai.js so a second surface (the /search AI overview) can
 * answer "มีสาขาที่ไหนบ้าง" without a second copy of the branch reader. It is
 * the DATA half of four assistant tools; the conversational half — every
 * `note:` telling the model to attach a map link, offer an escalation, or call
 * another tool — stays in chat-ai.js, because those are instructions to a
 * chat, and the search page has no chat to instruct.
 *
 * ---------------------------------------------------------------------------
 * WHAT MUST NEVER MOVE INTO THIS FILE
 * ---------------------------------------------------------------------------
 * No formula that turns a device into a number. Specifically:
 * `resolveOptionDeduction`, `tierDeduction`, `pickBatteryOptionId`,
 * `batteryOptionRange` and the `create_quote_card` body all stay in
 * chat-ai.js, and `zoneFeeOf` / `haversineKm` / the `check_pickup_service`
 * body stay there too.
 *
 * They belong to chat-ai.js not because chat owns them but because they need
 * an INPUT ONLY A CONVERSATION HAS: the condition answers the customer gave,
 * the battery percentage they typed, the address they pasted. The overview has
 * none of those. A price computed without them is a number the customer will
 * hold us to at the door and we will not honour — the exact failure the
 * quote-card provenance guard exists to prevent.
 *
 * So the test for whether something belongs here is not "does chat use it"
 * (chat uses everything) but: **would the answer still be true for a stranger
 * who typed one word into a search box?** Branch addresses, opening hours, the
 * FAQ, the published zone table, a campaign's face value — yes. A quote, a
 * pickup fee for one address, a deduction — no.
 *
 * functions/test/service-facts.test.mjs enforces this by grepping for those
 * identifiers, so the rule fails a test run rather than a code review.
 *
 * Everything here reads only; `db` is passed in rather than imported so the
 * pure builders stay testable with no Firebase.
 */

// ---------------------------------------------------------------------------
// FAQ — mirror จาก bkk-frontend-next/app/faq/faqData.ts (มาสเตอร์ 50 ข้อ 5 หมวด)
// AI อ่านเป็น knowledge แล้ว "สรุปตอบเป็นภาษาคน" ไม่ใช่แปะให้ลูกค้าอ่าน
// แก้ FAQ ที่ faqData.ts ต้อง sync ที่นี่ด้วย
// ---------------------------------------------------------------------------
const FAQ = [
  { c: "การรับซื้อ", q: "รับซื้ออุปกรณ์อะไรบ้าง", a: "รับซื้ออุปกรณ์ Apple ทุกประเภท: iPhone (iPhone 7 ขึ้นไป), iPad ทุกรุ่น, MacBook (Air/Pro), iMac, Mac mini, Apple Watch, AirPods และอุปกรณ์เสริม ราคาอิงตลาดจริงอัปเดตทุกวัน" },
  { c: "การรับซื้อ", q: "ขั้นตอนการขายเป็นอย่างไร", a: "1) เลือกรุ่นบนเว็บ 2) ระบุสภาพเครื่องตามจริงเพื่อประเมินราคา 3) เลือกวิธีส่งมอบ (Rider รับถึงบ้าน / มาที่สาขา / ส่งพัสดุ Mail-in) 4) ทีมงานตรวจเช็คแล้วโอนเงินทันที" },
  { c: "การรับซื้อ", q: "ราคาประเมินบนเว็บเป็นราคาสุดท้ายไหม", a: "เป็นราคาสูงสุดโดยประมาณ ราคาสุดท้ายขึ้นกับผลตรวจสภาพจริง ถ้าสภาพตรงที่ระบุจะได้ราคาตามประเมิน ถ้ามีตำหนิเพิ่มราคาอาจปรับลดลง" },
  { c: "การรับซื้อ", q: "รับซื้อเครื่องจอแตก เครื่องเสีย มีปัญหาไหม", a: "รับซื้อทุกสภาพ ทั้งจอแตก แบตเสื่อม ลำโพงเสีย Face ID ใช้ไม่ได้ เครื่องค้าง ราคาปรับตามสภาพความเสียหาย เลือกสภาพตามจริงตอนประเมิน" },
  { c: "การรับซื้อ", q: "ต้องเตรียมเอกสารอะไร", a: "การขายทั่วไปไม่ต้องใช้เอกสาร แต่ควร Sign Out Apple ID/iCloud + ปิด Find My iPhone มีกล่อง/ใบเสร็จช่วยเพิ่มมูลค่าเล็กน้อย ขายในนามนิติบุคคลอาจต้องใช้เอกสารเพิ่ม" },
  { c: "การรับซื้อ", q: "ต้องลบข้อมูลก่อนขายไหม", a: "ไม่จำเป็น ทีมงาน Factory Reset ให้หลังตรวจเช็คเสร็จ แต่แนะนำสำรองข้อมูลสำคัญไว้ก่อน และออกจาก iCloud เพื่อความรวดเร็ว" },
  { c: "การรับซื้อ", q: "รับซื้อเครื่องผ่อนอยู่ได้ไหม", a: "ไม่รับซื้อเครื่องที่ยังผ่อนไม่หมด ติดล็อก MDM หรือติดล็อก iCloud/Activation Lock เนื่องจากมีข้อจำกัดในการใช้งานและด้านกรรมสิทธิ์ ถ้าผ่อนครบหรือปลดล็อกเรียบร้อยแล้วค่อยนำมาประเมินราคาได้" },
  { c: "การรับซื้อ", q: "รับซื้อเครื่องติด iCloud หรือ Activation Lock ไหม", a: "ไม่รับซื้อเครื่องที่ติดล็อก iCloud/Activation Lock หรือยัง Sign out Apple ID ไม่ได้ ในทุกกรณี (ไม่มีการรับแล้วหักราคาหรือรับไปปลดล็อกเอง) ลูกค้าต้องปลดล็อก/Sign out iCloud ให้เรียบร้อยก่อน ถึงจะนำเครื่องมาประเมินราคาได้" },
  { c: "การรับซื้อ", q: "ต้องมีกล่อง อุปกรณ์ ใบเสร็จไหม", a: "ไม่จำเป็น รับซื้อตัวเครื่องเปล่าได้ แต่ถ้ามีกล่องครบ อุปกรณ์ครบ หรือใบเสร็จ/ใบรับประกัน อาจได้ราคาดีขึ้นเล็กน้อย" },
  { c: "การรับซื้อ", q: "มีบริการรับซื้อถึงบ้านไหม", a: "มี พื้นที่บริการมี Rider รับถึงหน้าบ้าน มีค่าบริการตามระยะทาง (ระบบแจ้งยอดชัดเจนก่อนยืนยัน และบางรุ่น/บางพื้นที่มีโปรฟรีค่าบริการ — เช็คได้ในแชท) ต่างจังหวัดใช้ส่งพัสดุ Mail-in ฟรี ค่าส่งทางร้านออกให้" },
  { c: "การรับซื้อ", q: "ตรวจสภาพเครื่องอย่างไร", a: "ตรวจทั้งภายนอก-ใน: หน้าจอ ตัวเครื่อง ฟังก์ชัน (Face ID/Touch ID/ลำโพง/กล้อง/แบต) สถานะ iCloud Lock และ Battery Health ใช้เวลา 5-10 นาที" },
  { c: "การยกเลิก", q: "ยกเลิกการขายได้ไหม", a: "ได้ ยกเลิกได้ตลอดก่อนกดยืนยันรับเงิน ถ้ายังไม่ส่งมอบเครื่องยกเลิกผ่านระบบได้ทันที" },
  { c: "การยกเลิก", q: "ยกเลิกหลังส่งเครื่องแล้วได้ไหม", a: "ถ้าส่งมาแล้วแต่ยังไม่กดยืนยันรับเงิน แจ้งยกเลิกได้ (ติดต่อทีมงาน) ร้านส่งเครื่องคืนให้ฟรีภายใน 7 วัน" },
  { c: "การยกเลิก", q: "ยกเลิกหลังรับเงินแล้วได้ไหม", a: "หลังกดยืนยันรับเงินและโอนแล้วถือว่าซื้อขายสมบูรณ์ ยกเลิกไม่ได้ กรุณาตรวจสอบราคาและเงื่อนไขให้ดีก่อนยืนยัน" },
  { c: "การยกเลิก", q: "ยกเลิกมีค่าใช้จ่ายไหม", a: "ไม่มีค่าใช้จ่ายในการยกเลิก กรณีส่งเครื่องมาแล้ว ค่าจัดส่งคืนทางร้านรับผิดชอบทั้งหมด" },
  { c: "การยกเลิก", q: "ราคาจริงต่ำกว่าประเมิน ยกเลิกได้ไหม", a: "ได้ ถ้าราคาหลังตรวจต่ำกว่าที่ประเมิน มีสิทธิ์ไม่รับราคาใหม่และยกเลิกได้ทันที ไม่มีค่าใช้จ่าย ร้านส่งเครื่องคืนให้" },
  { c: "การยกเลิก", q: "ได้เครื่องคืนกี่วัน", a: "กรณีส่งเครื่องมาแล้ว หลังแจ้งยกเลิกส่งคืนภายใน 1-3 วันทำการ ผ่าน Kerry/Flash พร้อมเลขพัสดุติดตาม" },
  { c: "การยกเลิก", q: "ยกเลิกนัด Rider ได้ไหม", a: "ได้ ยกเลิกก่อนเวลานัดอย่างน้อย 1 ชั่วโมง ถ้ายกเลิกหลัง Rider ออกเดินทางแล้วอาจมีค่าเดินทางเล็กน้อย" },
  { c: "การยกเลิก", q: "ยกเลิกแล้วคูปองหายไหม", a: "ถ้าใช้คูปอง/โปรในคำสั่งขาย เมื่อยกเลิกคูปองจะคืนกลับอัตโนมัติ ใช้ครั้งถัดไปได้ภายในวันหมดอายุ" },
  { c: "ค่าบริการ", q: "คิดค่าบริการรับซื้อไหม", a: "ประเมินราคาและตรวจสภาพฟรี ไม่มีค่าธรรมเนียมแอบแฝง มีเฉพาะกรณีเลือกให้ Rider ไปรับถึงบ้านที่มีค่าบริการตามระยะทาง (ระบบแจ้งยอดชัดเจนก่อนยืนยัน และบางรุ่น/บางพื้นที่มีโปรฟรีค่าบริการ) ส่วนมาที่สาขาหรือส่งพัสดุ Mail-in ไม่มีค่าใช้จ่ายใดๆ" },
  { c: "ค่าบริการ", q: "มีค่าจัดส่งไหม", a: "Rider รับถึงบ้านมีค่าบริการตามระยะทาง แจ้งยอดก่อนยืนยันเสมอ (บางรุ่น/บางพื้นที่มีโปรฟรีค่าบริการ — สอบถามในแชทได้เลย) ส่งพัสดุ Mail-in ฟรีทั่วประเทศ ร้านออกค่าส่งให้พร้อมประกันความเสียหายเต็มมูลค่า มาที่สาขาไม่มีค่าใช้จ่าย" },
  { c: "ค่าบริการ", q: "ชำระเงินช่องทางไหน", a: "โอนเข้าบัญชีธนาคารโดยตรง รองรับทุกธนาคารและพร้อมเพย์ หรือรับเงินสดที่สาขา" },
  { c: "ค่าบริการ", q: "ได้เงินเร็วแค่ไหน", a: "มาสาขา: ภายใน 15 นาที | Rider: โอนภายใน 5 นาทีหลังตรวจเสร็จ | Mail-in: โอนภายในวันที่ร้านได้รับเครื่อง (อาจช้าเล็กน้อยตามเวลาธนาคาร)" },
  { c: "ค่าบริการ", q: "ใช้คูปอง/โปรอย่างไร", a: "กรอกรหัสคูปองตอนยืนยันคำสั่งขาย ส่วนลดจะเพิ่มเป็นราคารับซื้อที่สูงขึ้น เช่นคูปอง +200 บาท = ราคาเพิ่ม 200 จากราคาประเมิน" },
  { c: "ค่าบริการ", q: "โอนเงินไม่สำเร็จทำไง", a: "ตรวจเลขบัญชีให้ถูก ถ้าถูกแล้วเงินไม่เข้า ติดต่อทีมงาน LINE @bkkapple ตรวจสอบและโอนซ้ำภายใน 24 ชั่วโมง" },
  { c: "ค่าบริการ", q: "ขอใบเสร็จได้ไหม", a: "ระบบส่งสลิปโอนอัตโนมัติทางอีเมล/LINE ถ้าต้องการใบเสร็จรับเงินอย่างเป็นทางการแจ้งทีมงานได้ ออกให้ภายใน 3 วันทำการ" },
  { c: "ค่าบริการ", q: "ราคาอัปเดตบ่อยแค่ไหน", a: "ราคารับซื้ออัปเดตทุกวัน อิงราคาตลาดจริงในและต่างประเทศ อาจเปลี่ยนตามตลาด โดยเฉพาะช่วง Apple เปิดตัวรุ่นใหม่" },
  { c: "ค่าบริการ", q: "ขายหลายเครื่องมีโปรไหม", a: "มี ขายตั้งแต่ 2 เครื่องขึ้นไปครั้งเดียวได้โบนัสเพิ่ม องค์กร/บริษัทขายจำนวนมากติดต่อทีม Corporate ที่หน้า /corporate เพื่อราคาพิเศษ" },
  { c: "PDPA", q: "เก็บข้อมูลส่วนบุคคลอะไรบ้าง", a: "เก็บเฉพาะที่จำเป็น: ชื่อ-นามสกุล เบอร์โทร อีเมล ที่อยู่จัดส่ง เลขบัญชี และข้อมูลอุปกรณ์ (รุ่น IMEI) ตาม PDPA" },
  { c: "PDPA", q: "ข้อมูลถูกนำไปใช้อย่างไร", a: "ใช้เพื่อ: รับซื้อ+โอนเงิน, ติดต่อเรื่องคำสั่งขาย, ออกเอกสารบัญชี, ปรับปรุงบริการ (ถ้ายินยอม) ไม่ขาย/เปิดเผยให้บุคคลภายนอกโดยไม่ได้รับอนุญาต" },
  { c: "PDPA", q: "ขอลบข้อมูลส่วนบุคคลได้ไหม", a: "ได้ ตาม PDPA ติดต่อ DPO ที่ dpo@bkkapple.com ดำเนินการภายใน 30 วัน ยกเว้นข้อมูลที่จำเป็นทางกฎหมาย (เอกสารบัญชี) อาจลบไม่ได้" },
  { c: "PDPA", q: "ข้อมูลในเครื่องที่ขายจัดการอย่างไร", a: "หลังรับซื้อ ทีมงาน Factory Reset ลบข้อมูลทั้งหมดกู้คืนไม่ได้ แนะนำสำรองข้อมูลและ Sign Out Apple ID ก่อน" },
  { c: "PDPA", q: "ถอนความยินยอมได้ไหม", a: "ได้ตลอดเวลา ผ่านหน้าตั้งค่าบัญชีหรืออีเมล dpo@bkkapple.com ไม่กระทบธุรกรรมที่เกิดก่อนหน้า" },
  { c: "PDPA", q: "DPO ติดต่ออย่างไร", a: "เจ้าหน้าที่คุ้มครองข้อมูลส่วนบุคคล (DPO) ติดต่อ dpo@bkkapple.com ตอบกลับภายใน 7 วันทำการ" },
  { c: "PDPA", q: "เก็บข้อมูลนานเท่าไร", a: "ข้อมูลธุรกรรมเก็บตามกฎหมาย (บัญชี 5 ปี) จากนั้นลบหรือทำให้ระบุตัวตนไม่ได้ ข้อมูลการตลาดเก็บจนกว่าจะถอนความยินยอม" },
  { c: "PDPA", q: "สิทธิ์ตาม PDPA มีอะไรบ้าง", a: "เข้าถึง แก้ไข ลบ ระงับการใช้ คัดค้าน โอนย้ายข้อมูล และถอนความยินยอม ใช้สิทธิ์ผ่าน dpo@bkkapple.com" },
  { c: "ทั่วไป", q: "ต้องสมัครสมาชิกก่อนไหม", a: "เช็คราคาได้เลยไม่ต้องสมัคร แต่ถ้าจะทำรายการขายต้องสมัคร/ล็อกอินก่อน เพื่อเก็บประวัติและรับแจ้งเตือนสถานะ สมัครง่ายผ่านเบอร์โทรหรือ LINE" },
  { c: "ทั่วไป", q: "ติดตามสถานะคำสั่งขายอย่างไร", a: "ล็อกอินบนเว็บแล้วไปหน้า 'คำสั่งขายของฉัน' เห็นสถานะ Real-time และมีแจ้งเตือนผ่าน LINE/อีเมลทุกครั้งที่สถานะเปลี่ยน" },
  { c: "ทั่วไป", q: "น่าเชื่อถือไหม ปลอดภัยไหม", a: "จดทะเบียนถูกกฎหมาย ดำเนินกิจการมาหลายปี มีหน้าร้านชัดเจน รีวิว 5 ดาวจากลูกค้ากว่า 300+ รีวิวบน Google Maps" },
  { c: "ทั่วไป", q: "มีบริการลูกค้าองค์กร Corporate ไหม", a: "มี สำหรับองค์กรที่ขายอุปกรณ์จำนวนมาก (เปลี่ยนเครื่องพนักงาน โรงเรียน สถาบัน) ได้ราคาพิเศษ ดูที่หน้า /corporate" },
];

function normFaq(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, "");
}

function searchFaq(query) {
  const q = normFaq(query);
  if (!q) return FAQ.slice(0, 8).map((f) => ({ q: f.q, a: f.a }));
  const tokens = String(query).toLowerCase().split(/\s+/).filter((t) => t && t.length >= 2);
  const scored = FAQ.map((f) => {
    const hay = normFaq(f.c + f.q + f.a);
    let hits = 0;
    for (const t of tokens) if (hay.includes(t.replace(/\s+/g, ""))) hits++;
    if (hay.includes(q)) hits += 2;
    return { f, hits };
  })
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 6)
    .map((x) => ({ q: x.f.q, a: x.f.a }));
  return scored;
}

// FAQ ทางการ — mirror จาก bkk-frontend-next (app/components/home/FaqSection.tsx +
// app/components/checkout/CheckoutFAQ.tsx) แก้ FAQ เว็บต้อง sync ที่นี่ด้วย
const OFFICIAL_FAQ_LINES = [
  `- ไม่รับซื้อเครื่องที่ยังผ่อนไม่หมด (ผ่อนกับไฟแนนซ์/บัตรเครดิต), ติดล็อก iCloud/FMI (Find My)/Activation Lock, ติดล็อก MDM, หรือติด Blacklist/ล็อกเครือข่าย เด็ดขาด — ถ้าลูกค้าถามว่าเครื่องผ่อนอยู่/ติด iCloud/ติด MDM/ติด Blacklist รับไหม ตอบว่า "ไม่รับซื้อ" และแนะนำว่าถ้าผ่อนครบหรือปลดล็อกเรียบร้อยแล้วค่อยนำมาประเมินได้`,
  `- *** ย้ำเรื่อง iCloud/Activation Lock (ห้ามพลาดเด็ดขาด) ***: เครื่องที่ยังติดล็อก iCloud/ยัง Sign out Apple ID ไม่ได้/ติด Activation Lock = "ไม่รับซื้อ" ในทุกกรณี ไม่ว่าลูกค้าจะยอมขายถูกแค่ไหน. ห้ามพูดว่า "รับซื้อได้แต่ราคาต่ำ", "รับแล้วเอาไปปลดล็อกเอง", "หักราคาค่าปลดล็อก" หรืออะไรทำนองนี้เด็ดขาด — ข้อมูลนั้นผิด ร้านเราไม่รับความเสี่ยงเรื่องกรรมสิทธิ์/เครื่องหาย. คำตอบที่ถูกต้องคือ "ไม่รับ ต้องปลดล็อก/Sign out iCloud ให้เรียบร้อยก่อนถึงจะประเมินได้"`,
  `- เครื่องมีตำหนิ/จอแตก/เสียหาย: รับซื้อ ราคาลดตามสภาพจริง ให้เลือกสภาพตามจริงตอนประเมิน (ผ่านขั้นตอนถามสภาพ+ใบเสนอราคา) — ห้ามบอกเปอร์เซ็นต์การหักเอง`,
  `- *** เส้นแดงเรื่องการปลดล็อก iCloud/Activation Lock ***: แนะนำได้เฉพาะ "ช่องทางทางการของเจ้าของเครื่องเอง" เท่านั้น คือ Sign out ด้วยรหัส Apple ID ของตัวเอง, กู้รหัสผ่านที่ iforgot.apple.com, หรือติดต่อ Apple Support พร้อมหลักฐานการซื้อ — "ห้ามแนะนำวิธี bypass/hack/เครื่องมือปลดล็อก/บริการปลดล็อกภายนอก" เด็ดขาดทุกกรณี และถ้าบริบทส่อว่าเครื่องไม่ใช่ของลูกค้าเอง (เก็บได้ ซื้อต่อมาแบบไม่รู้ที่มา ไม่รู้รหัสและไม่ใช่บัญชีตัวเอง) ให้ปฏิเสธการช่วยปลดล็อกอย่างสุภาพและไม่ต้องแนะนำช่องทางใดๆ ต่อ`,
  `- ประเมินราคาฟรี 100% ไม่ต้องตกลงขายทันที ไม่มีค่าใช้จ่ายแอบแฝง`,
  `- จ่ายเงิน: ตรวจเช็คสภาพเสร็จ โอนเข้าบัญชีเต็มจำนวนทันทีหน้างาน ไม่เกิน 5 นาที`,
  `- ข้อมูลส่วนตัว/เตรียมเครื่องก่อนขาย: ลูกค้า "ไม่จำเป็นต้อง Factory Reset มาเอง" — ร้านทำ Factory Reset + Data Wipe ให้ดูต่อหน้าตอนรับเครื่อง พร้อมออก Data Wipe Certificate. สิ่งเดียวที่ลูกค้าต้องเตรียมคือ Sign out iCloud/ปิด Find My ให้ได้ (ต้องจำรหัส Apple ID) — "อย่าแนะนำให้ลูกค้าล้างเครื่องเองก่อนมา" เพราะถ้าล้างแล้วลืม Sign out iCloud เครื่องจะติด Activation Lock รับซื้อไม่ได้เลย. ตอบเรื่องนี้ให้ตรงนี้เสมอ ห้ามสลับไปมา`,
  `- ถ้าราคาหน้างานไม่ตรงที่ประเมิน: ปฏิเสธได้เสมอ ไม่มีค่าใช้จ่าย. กรณี Pickup/Store-in เครื่องยังอยู่กับลูกค้า/ตรวจต่อหน้า ปฏิเสธแล้วลูกค้าเก็บเครื่องกลับได้เลย (ไรเดอร์ไม่เอาเครื่องไป). กรณี Mail-in (ส่งมาแล้ว) ปฏิเสธได้และร้าน "ส่งเครื่องคืนฟรี" — คำว่าส่งคืนฟรีใช้กับ Mail-in เท่านั้น อย่าเอาไปพูดกับ Pickup`,
  `- รับซื้อทุกยี่ห้อทุกรุ่น เน้น iPhone/Samsung/iPad/MacBook/Apple Watch`,
];

const DEFAULT_DELIVERY_ZONES = [
  {
    id: "metro",
    name: "กรุงเทพและปริมณฑล",
    provinceIds: [1, 2, 3, 4, 58, 59],
    pricing: { type: "distance", baseFare: 50, freeRadius: 5, perKmRate: 10, maxFee: 300 },
    etaText: "1-2 ชั่วโมง",
  },
  {
    id: "eastern",
    name: "ชลบุรี / พัทยา / ฉะเชิงเทรา",
    provinceIds: [11, 15],
    pricing: { type: "flat", flatFee: 500 },
    etaText: "2-3 ชั่วโมง",
  },
];

function deliveryZonesFrom(raw) {
  if (raw && typeof raw === "object" && Array.isArray(raw.zones)) return raw.zones;
  if (raw && typeof raw === "object" && (raw.baseFare != null || raw.perKmRate != null)) {
    return [
      {
        ...DEFAULT_DELIVERY_ZONES[0],
        pricing: {
          type: "distance",
          baseFare: typeof raw.baseFare === "number" ? raw.baseFare : 50,
          freeRadius: typeof raw.freeRadius === "number" ? raw.freeRadius : 5,
          perKmRate: typeof raw.perKmRate === "number" ? raw.perKmRate : 10,
          maxFee: typeof raw.maxFee === "number" ? raw.maxFee : 300,
        },
      },
      DEFAULT_DELIVERY_ZONES[1],
    ];
  }
  return DEFAULT_DELIVERY_ZONES;
}

function toEpochMs(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v > 1e11 ? v : v * 1000;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

function promoWindowOpen(item, now) {
  const start = toEpochMs(item.start_date);
  let end = toEpochMs(item.end_date);
  // end_date แบบ date-only ("2026-07-31") ให้เผื่อถึงสิ้นวัน
  if (end != null && typeof item.end_date === "string" && !/[T ]/.test(item.end_date)) {
    end += 86399999;
  }
  if (start != null && now < start) return false;
  if (end != null && now > end) return false;
  return true;
}

function quotaFull(item) {
  return !!(item.total_limit && (item.used_count || 0) >= item.total_limit);
}

// Admin-authored knowledge graph (settings/chat_kb) — the "answer web" the
// owner edits visually on the bkk-system /chat-kb canvas (React Flow). Nodes
// are answer categories; each CUSTOM node holds Q&A items that are official
// store answers (they outrank the built-in FAQ on conflict, same as the free-
// text kb). LIVE nodes only mirror data the AI already reads via tools
// (coupons/prices/branches) — no items, skipped here. Node hierarchy comes
// from the drawn edges: a child category renders as "หมวดแม่ › หมวดลูก".
// Pure so the offline test harness can cover it without Firebase.
//
// Returns the ROWS ONLY — "[หมวด: …]" / "ถาม:" / "ตอบ:" — with no framing
// sentence around them. The framing that used to live here told the model to
// call escalate_to_human and to route quotes through create_quote_card, which
// is an instruction to a CHAT; it moved to buildKbGraphBlock in chat-ai.js so
// a surface with no tools cannot inherit orders it is unable to carry out.
// The overview wraps these same rows in framing of its own.
function kbGraphRows(kbGraph) {
  if (!kbGraph || typeof kbGraph !== "object") return "";
  const nodes = kbGraph.nodes && typeof kbGraph.nodes === "object" ? kbGraph.nodes : {};
  const edges = kbGraph.edges && typeof kbGraph.edges === "object" ? kbGraph.edges : {};
  const parentOf = {};
  for (const k of Object.keys(edges)) {
    const e = edges[k];
    if (e && e.from && e.to) parentOf[e.to] = e.from;
  }
  const pathLabel = (id) => {
    const parts = [];
    let cur = id;
    let hop = 0;
    while (cur && cur !== "root" && hop < 6) { // hop cap breaks accidental cycles
      const n = nodes[cur];
      if (!n || !n.label) break;
      parts.unshift(String(n.label));
      cur = parentOf[cur];
      hop++;
    }
    return parts.join(" › ");
  };
  const out = [];
  for (const id of Object.keys(nodes).sort()) {
    const n = nodes[id];
    if (!n || n.type !== "custom" || n.enabled === false) continue;
    const items = n.items && typeof n.items === "object" ? Object.values(n.items) : [];
    const rows = items
      .filter((it) => it && String(it.q || "").trim() && String(it.a || "").trim())
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
    if (rows.length === 0) continue;
    out.push(`[หมวด: ${pathLabel(id) || String(n.label || id)}]`);
    for (const it of rows) {
      out.push(`ถาม: ${String(it.q).trim().slice(0, 300)}`);
      out.push(`ตอบ: ${String(it.a).trim().slice(0, 1500)}`);
    }
    out.push("");
  }
  if (out.length === 0) return "";
  let body = out.join("\n").trim();
  if (body.length > 12000) body = body.slice(0, 12000); // prompt-size backstop
  return body;
}

// Central store profile block — the owner's standard values from
// settings/store_profile (/store-settings page). These are THE answers for
// "เบอร์ร้าน/ติดต่อยังไง/เปิดกี่โมง" — branch rows are per-location detail
// only. Pure/testable; empty profile renders nothing.
function buildStoreProfileBlock(profile) {
  if (!profile || typeof profile !== "object") return "";
  const lines = [];
  if (profile.phone) lines.push(`- เบอร์กลางของร้าน: ${profile.phone}`);
  if (profile.line_id) lines.push(`- LINE: ${profile.line_id}`);
  if (profile.email) lines.push(`- อีเมล: ${profile.email}`);
  if (profile.hours_start && profile.hours_end)
    lines.push(`- เวลาทำการมาตรฐาน: ${profile.hours_start}-${profile.hours_end} น. ทุกวัน`);
  if (profile.website) lines.push(`- เว็บไซต์: ${profile.website}`);
  if (lines.length === 0) return "";
  return [
    "",
    "ข้อมูลติดต่อกลางของร้าน (ค่ามาตรฐานที่เจ้าของร้านตั้งไว้ — ยืนยันแล้ว ใช้ตอบได้ทันที): ลูกค้าขอเบอร์/ช่องทางติดต่อ/เวลาทำการ ให้ตอบจากตรงนี้ก่อนเสมอ สั้นๆ 1-2 บรรทัด ไม่ต้องเรียก get_branches. ข้อมูลรายสาขา (ที่อยู่/แผนที่/เวลาเฉพาะสาขา) ค่อยใช้ get_branches เมื่อลูกค้าถามหาสาขา/ที่ตั้ง. ถ้าเวลาเฉพาะสาขาต่างจากเวลามาตรฐาน ให้ระบุว่าเป็นเวลาของสาขานั้น:",
    ...lines,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Loaders. Read-only, and deliberately NOT error-swallowing: each caller
// already has its own fallback (chat keeps talking without a KB block; the
// overview simply omits a section), and a loader that returns {} on failure
// makes "the shop has no branches" indistinguishable from "the read failed".
// ---------------------------------------------------------------------------

/** settings/store_profile — the owner's standard phone/LINE/email/hours.
 *  THE answer for "เบอร์ร้าน/เปิดกี่โมง"; per-branch rows are detail only. */
async function loadStoreProfile(db) {
  const snap = await db.ref("settings/store_profile").once("value");
  return snap.exists() ? snap.val() || {} : {};
}

/** settings/chat_kb — the admin-drawn answer web. Null when unset, so a caller
 *  can tell "nothing authored" from "an empty graph". */
async function loadKbGraph(db) {
  const snap = await db.ref("settings/chat_kb").once("value");
  return snap.exists() ? snap.val() : null;
}

/**
 * Active branches, plus the central contact block.
 *
 * The central profile rides along so no caller has to stitch a "main number /
 * standard hours" out of per-branch rows — the source of the 08:00-vs-10:00
 * contradiction that put two different opening times in one conversation.
 * Central is best-effort: branches are the answer, contact details are a bonus.
 */
async function loadBranches(db) {
  let central = null;
  try {
    const sp = await loadStoreProfile(db);
    if (sp.phone || sp.line_id || sp.hours_start) {
      central = {
        phone: sp.phone || null,
        line_id: sp.line_id || null,
        email: sp.email || null,
        standard_hours: sp.hours_start && sp.hours_end ? `${sp.hours_start}-${sp.hours_end} น.` : null,
      };
    }
  } catch { /* best-effort */ }

  const snap = await db.ref("settings/branches").once("value");
  const branches = [];
  const all = snap.val() || {};
  for (const key of Object.keys(all)) {
    const b = all[key];
    if (!b || b.isActive === false) continue;
    const fmtHour = (h) =>
      Number.isFinite(Number(h)) ? `${String(Number(h)).padStart(2, "0")}:00` : null;
    const open = fmtHour(b.openHour);
    const close = fmtHour(b.closeHour);
    branches.push({
      name: b.name || key,
      address: b.address || null,
      phone: b.phone || null,
      open_hours: open && close ? `${open} - ${close} น.` : null,
      open_today: b.isOpen === false ? false : true,
      map_link:
        typeof b.lat === "number" && typeof b.lng === "number"
          ? `https://www.google.com/maps?q=${b.lat},${b.lng}`
          : null,
      map_info: b.mapInfo || null,
    });
  }
  return { central, branches };
}

/**
 * Campaigns that are live right now — public coupons and rider-fee promotions.
 *
 * The values here are a campaign's FACE VALUE ("+500 บาท"), which is a
 * published fact, not a computed one: nothing on this path looks at a device
 * or an address. `model_restricted` / `province_restricted` are carried
 * through precisely so a caller that cannot check the restriction can drop
 * those rows instead of advertising a bonus the customer will not get.
 * System masters (REVIEW_REWARD) are never advertised.
 */
async function loadPromotions(db) {
  const now = Date.now();
  const [couponsSnap, promosSnap] = await Promise.all([
    db.ref("coupons").once("value"),
    db.ref("rider_fee_promotions").once("value"),
  ]);

  const coupons = [];
  const cs = couponsSnap.val() || {};
  for (const key of Object.keys(cs)) {
    const c = cs[key];
    // system master (เช่น REVIEW_REWARD) ห้ามโฆษณาเป็นคูปองแจก
    if (!c || c.system === true) continue;
    if (c.is_active === false || !promoWindowOpen(c, now) || quotaFull(c)) continue;
    coupons.push({
      code: c.code || key,
      name: c.name || c.title || "",
      type: c.type || "fixed",
      value: Number(c.value || 0),
      min_trade_value: Number(c.min_trade_value || 0) || undefined,
      model_restricted:
        c.is_model_restricted === true ||
        (Array.isArray(c.applicable_models) && c.applicable_models.length > 0) ||
        undefined,
      end_date: c.end_date || null,
    });
  }

  const riderPromos = [];
  const ps = promosSnap.val() || {};
  for (const key of Object.keys(ps)) {
    const p = ps[key];
    if (!p || p.is_active === false || !promoWindowOpen(p, now) || quotaFull(p)) continue;
    riderPromos.push({
      name: p.name || p.code || key,
      discount_type: p.discount_type || "fixed",
      value: Number(p.value || 0),
      max_discount: Number(p.max_discount || 0) || undefined,
      province_restricted:
        p.is_province_restricted === true ||
        (Array.isArray(p.applicable_provinces) && p.applicable_provinces.length > 0) ||
        undefined,
      model_restricted:
        p.is_model_restricted === true ||
        (Array.isArray(p.applicable_models) && p.applicable_models.length > 0) ||
        undefined,
      end_date: p.end_date || null,
    });
  }

  return { coupons, pickup_fee_promotions: riderPromos };
}

/**
 * The published delivery-zone TABLE — which provinces we ride to and how each
 * zone is priced in principle.
 *
 * This is the price LIST, not a price. Turning it into a baht figure needs a
 * geocoded address and a distance, which is why `zoneFeeOf` and the
 * check_pickup_service body stay in chat-ai.js. Anything reading this may say
 * "โซนกรุงเทพเริ่ม 50 บาท คิดตามระยะทาง"; nothing reading this may say what a
 * particular customer will pay.
 */
async function loadDeliveryZones(db) {
  const snap = await db.ref("settings/store/delivery_pricing").once("value");
  return deliveryZonesFrom(snap.val());
}

/** settings/store/accept_defective_devices — do we buy cracked/faulty units.
 *  A yes/no shop policy; the size of the deduction is not decided here. */
async function loadAcceptDefective(db) {
  const snap = await db.ref("settings/store/accept_defective_devices").once("value");
  return snap.exists() ? snap.val() : null;
}

module.exports = {
  // pure
  FAQ,
  OFFICIAL_FAQ_LINES,
  DEFAULT_DELIVERY_ZONES,
  searchFaq,
  deliveryZonesFrom,
  promoWindowOpen,
  quotaFull,
  toEpochMs,
  kbGraphRows,
  buildStoreProfileBlock,
  // loaders
  loadStoreProfile,
  loadKbGraph,
  loadBranches,
  loadPromotions,
  loadDeliveryZones,
  loadAcceptDefective,
};
