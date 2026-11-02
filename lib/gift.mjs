// 주소 없는 꽃 선물(11/2). 보내는 분이 먼저 결제하고, 받는 분이 링크(/g/<code>)에서 주소를 넣는다.
// ⚠️ 보내는 분도 같은 링크를 갖고 있다. 그래서 링크를 다시 열 때 주소를 절대 돌려주지 않는다(giftPublicView).
//    고칠 때도 예전 값을 보여 주지 않고 새로 받는다.
import crypto from "node:crypto";
import "../regions.js";
import { PRODUCTS } from "../products.mjs";
import { sendTransactionalText } from "./solapi.mjs";

export const GIFT_DAYS = 7;
export const GIFT_REMIND_DAYS = 3;
// 주문 원장의 상태. 돈은 들어왔지만 주소가 없어 아직 만들면 안 되는 주문.
export const GIFT_WAIT = "gift_wait";
// 선물 주문번호는 AFG 로 시작한다(AFB 무통장·AFC 맞춤 링크처럼).
export const GIFT_ORDER_RE = /^AFG\d{8}-[A-Z0-9]{6,20}$/;
// 사람에게 직접 가는 상품만. 근조·축하 화환은 받는 곳이 빈소·식장이라 뺐다.
export const GIFT_CATS = new Set(["bouquet", "basket", "orchid", "plant"]);
export const giftEnabled = (env = process.env) => env.GIFT_ENABLED === "1";
export const GIFT_CODE_RE = /^[A-Za-z0-9]{10}$/;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";   // 헷갈리는 글자(O0Il1)는 뺐다
const SLOTS = { am: "오전중", pm: "오후중", today: "당일중" };
// index.html 의 AF_CUTOFF_WEEKDAY·WEEKEND 와 같은 값으로 맞출 것
const CUTOFF_WEEKDAY = 18, CUTOFF_WEEKEND = 16;

// 받는 분 링크 코드는 주문번호에서 서명으로 만든다. 결제 승인·대사·재시도가 몇 번을 돌아도 같은 링크가 나오고,
// 주문번호만 알아서는 코드를 맞힐 수 없다.
function linkSecret(env) { return env.GIFT_LINK_SECRET || env.CRON_SECRET || env.TOSS_SECRET_KEY || ""; }
export function giftCodeFor(orderId, env = process.env) {
  const secret = linkSecret(env);
  if (!secret || !orderId) return "";
  const h = crypto.createHmac("sha256", secret).update(`gift:${orderId}`).digest();
  return Array.from(h.subarray(0, 10), (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
}
const baseUrl = (env) => String(env.PUBLIC_BASE_URL || "https://floweranbu.co.kr").replace(/\/+$/, "");
export const giftUrl = (code, env = process.env) => `${baseUrl(env)}/g/${code}`;
const digits = (v) => String(v == null ? "" : v).replace(/[^0-9]/g, "");
const isMobile = (v) => /^01[016789]\d{7,8}$/.test(digits(v));
const won = (n) => `${Number(n || 0).toLocaleString("ko-KR")}원`;

export function newGiftCode() {
  const bytes = crypto.randomBytes(10);
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
}

// 서버는 UTC 로 돈다. 날짜·요일·시각은 한국시간으로 본다.
function kst(now) {
  const d = new Date(now.getTime() + 9 * 3600 * 1000);
  return { iso: d.toISOString().slice(0, 10), hour: d.getUTCHours(), day: d.getUTCDay() };
}

/** 받는 분 화면에 보일 단계. 준비가 시작되면 주소를 고칠 수 없다. */
export function giftStage(row, now = new Date(), orderStatus = "") {
  if (row.status === "declined") return "declined";
  if (row.status === "canceled" || orderStatus === "canceled") return "closed";
  if (orderStatus === "delivered") return "delivered";
  if (orderStatus === "ordered") return "preparing";
  if (row.status === "filled") return row.extra_fee > 0 ? "checking" : "got";
  if (row.status === "expired" || new Date(row.expires_at) <= now) return "closed";
  return "wait";
}

/** 링크로 나가는 값. 주소·배송 요청·받는 분이 고친 번호는 여기에 넣지 않는다. */
export function giftPublicView(row, now = new Date(), orderStatus = "") {
  const stage = giftStage(row, now, orderStatus);
  const view = { stage };
  if (stage === "closed") return view;
  view.to = row.recipient_name;
  view.from = row.sender_name;
  view.message = row.message || "";
  view.product = row.product_label || "";
  view.photo = row.product_photo || "";
  if (stage === "wait") {
    view.phone = row.recipient_phone;
    view.until = row.expires_at;
  } else if (stage !== "declined") {
    view.date = row.deliver_date || "";
    view.slot = SLOTS[row.deliver_slot] || "";
  }
  return view;
}

const clean = (v, n) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

/** 받는 분이 넣은 값 검사. 지금 주문서 규칙(마감 시각·지난 날짜)과 같게 맞춘다. */
export function checkGiftFill(input, now = new Date()) {
  const o = input || {};
  const address = clean(o.address, 200), detail = clean(o.detail, 100), note = clean(o.note, 120);
  const phone = String(o.phone || "").replace(/[^0-9]/g, "");
  const date = String(o.date || ""), slot = String(o.slot || "");
  if (address.length < 5) return { error: "받으실 주소를 넣어 주세요." };
  if (!/^01[0-9]{8,9}$/.test(phone)) return { error: "연락처를 확인해 주세요." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "받을 날짜를 골라 주세요." };
  const t = kst(now);
  if (date < t.iso) return { error: "지난 날짜로는 보낼 수 없어요. 날짜를 다시 골라 주세요." };
  if (date === t.iso) {
    const cut = t.day === 0 || t.day === 6 ? CUTOFF_WEEKEND : CUTOFF_WEEKDAY;
    if (t.hour >= cut) return { error: `오늘 배송은 ${cut}시까지 접수합니다. 다른 날짜를 골라 주세요.` };
  }
  if (!SLOTS[slot]) return { error: "도착 시간을 골라 주세요." };
  if (o.consent !== true) return { error: "주소와 연락처를 알려 주는 데 동의해 주세요." };
  const place = `${address} ${detail}`;
  const region = globalThis.regionCheck(place);
  if (region && region.blocked) return { error: "이 주소는 배송이 어려워요. 다른 주소를 넣어 주시거나 1577-2286으로 전화 주세요.", blocked: true };
  return { value: { address, address_detail: detail, delivery_note: note, filled_phone: phone, deliver_date: date, deliver_slot: slot, extra_fee: (region && region.amt) || 0 } };
}

function sb(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return { url: env.SUPABASE_URL, headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } };
}
async function loadGift(s, code) {
  const r = await fetch(`${s.url}/rest/v1/gift_links?code=eq.${code}&select=*&limit=1`, { headers: s.headers });
  if (!r.ok) return { error: true };
  const rows = await r.json().catch(() => []);
  return { row: rows[0] || null };
}
async function orderStatusOf(s, row) {
  if (!row.order_id) return "";
  const r = await fetch(`${s.url}/rest/v1/orders?order_id=eq.${encodeURIComponent(row.order_id)}&select=status&limit=1`, { headers: s.headers }).catch(() => null);
  if (!r || !r.ok) return "";
  const rows = await r.json().catch(() => []);
  return (rows[0] && rows[0].status) || "";
}

export async function handleGiftGet(q, env = process.env) {
  const code = String(q.gift || "");
  if (!GIFT_CODE_RE.test(code)) return { status: 404, json: { error: "없는 링크예요." } };
  const s = sb(env);
  if (!s) return { status: 503, json: { error: "잠시 후 다시 시도해 주세요." } };
  const { row, error } = await loadGift(s, code);
  if (error) return { status: 503, json: { error: "잠시 후 다시 시도해 주세요." } };
  if (!row) return { status: 404, json: { error: "없는 링크예요." } };
  return { status: 200, json: giftPublicView(row, new Date(), await orderStatusOf(s, row)) };
}

export async function handleGiftPost(body, env = process.env, deps = {}) {
  const code = String(body.code || "");
  if (!GIFT_CODE_RE.test(code)) return { status: 404, json: { error: "없는 링크예요." } };
  const s = sb(env);
  if (!s) return { status: 503, json: { error: "잠시 후 다시 시도해 주세요." } };
  const { row, error } = await loadGift(s, code);
  if (error) return { status: 503, json: { error: "잠시 후 다시 시도해 주세요." } };
  if (!row) return { status: 404, json: { error: "없는 링크예요." } };
  const now = new Date();
  const stage = giftStage(row, now, await orderStatusOf(s, row));
  const patch = (fields, cond) => fetch(`${s.url}/rest/v1/gift_links?code=eq.${code}&${cond}`, {
    method: "PATCH", headers: { ...s.headers, "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(fields),
  });
  if (body.action === "decline") {
    if (stage !== "wait") return { status: 409, json: { error: "1577-2286으로 전화 주세요." } };
    const r = await patch({ status: "declined" }, "status=eq.waiting");
    const saved = r.ok ? await r.json().catch(() => []) : [];
    if (!saved[0]) return { status: 409, json: { error: "1577-2286으로 전화 주세요." } };
    await afterGiftDecline(row, env).catch(() => null);
    return { status: 200, json: { ok: true } };
  }
  if (body.action !== "fill") return { status: 400, json: { error: "잘못된 요청이에요." } };
  if (stage !== "wait" && stage !== "got" && stage !== "checking") return { status: 409, json: { error: "주소를 고치려면 1577-2286으로 전화 주세요." } };
  const checked = checkGiftFill(body, now);
  if (checked.error) return { status: 400, json: { error: checked.error, blocked: !!checked.blocked } };
  const r = await patch({ ...checked.value, status: "filled", filled_at: now.toISOString(), consent_at: now.toISOString() }, "status=in.(waiting,filled)");
  const saved = r.ok ? await r.json().catch(() => []) : [];
  if (!saved[0]) return { status: 409, json: { error: "잠시 후 다시 시도해 주세요." } };
  // 주문 원장에 옮기지 못하면 성공이라고 하지 않는다. 다시 누르면 같은 값으로 다시 옮긴다(filled → filled).
  const after = await afterGiftFill(row, checked.value, { first: row.status === "waiting" }, deps, env).catch(() => ({ ok: false }));
  if (!after.ok) return { status: 503, json: { error: "저장을 마치지 못했어요. 잠시 후 다시 눌러 주세요." } };
  return { status: 200, json: { ok: true, stage: checked.value.extra_fee > 0 ? "checking" : "got", date: checked.value.deliver_date, slot: SLOTS[checked.value.deliver_slot] } };
}

// ── 결제 쪽 ──────────────────────────────────────────────────────────

/** 주문서가 보낸 선물 주문을 결제 전에 본다. 통과하면 null. category 는 서버가 상품 코드로 찾은 값. */
export function checkGiftOrder(order, { orderId, userId, category, env = process.env }) {
  const o = order || {};
  if (!giftEnabled(env)) return "카톡·링크로 보내기는 아직 준비 중이에요. 받는 분 주소를 넣어 주문해 주세요.";
  if (!GIFT_ORDER_RE.test(String(orderId || ""))) return "주문번호가 올바르지 않습니다. 처음부터 다시 주문해 주세요.";
  if (!userId) return "카톡·링크로 보내려면 먼저 로그인해 주세요.";
  if (!GIFT_CATS.has(category)) return "이 상품은 받는 분 주소를 넣어 주문해 주세요.";
  if (o.customPay) return "맞춤 결제 링크로는 보낼 수 없어요.";
  if (Array.isArray(o.items) && o.items.length >= 2) return "카톡·링크로 보내기는 상품 하나씩 주문해 주세요.";
  if (!String(o.recipientName || "").trim()) return "받는 분 성함을 알려 주세요.";
  if (!isMobile(o.recipientPhone)) return "받는 분 휴대폰 번호를 확인해 주세요. 이 번호로 링크가 가요.";
  if (!String(o.senderName || "").trim()) return "보내는 분 성함을 입력해 주세요.";
  if (!isMobile(o.senderPhone)) return "보내는 분 휴대폰 번호를 확인해 주세요.";
  return null;
}

function photoOf(productCode) {
  const p = PRODUCTS.find((x) => x.pc === productCode);
  return (p && Array.isArray(p.photos) && p.photos[0]) || null;
}

/** 결제가 확인된 선물 주문의 링크 행. */
export function giftRowFromOrder(order, orderId, now = new Date(), env = process.env) {
  const o = order || {};
  return {
    code: giftCodeFor(orderId, env),
    order_id: orderId,
    status: "waiting",
    recipient_name: clean(o.recipientName, 40),
    recipient_phone: digits(o.recipientPhone),
    sender_name: clean(o.senderName, 40),
    message: clean(o.cardMessage, 150) || null,
    product_label: clean(o.productLabel, 80) || null,
    product_photo: photoOf(o.productCode),
    expires_at: new Date(now.getTime() + GIFT_DAYS * 86400000).toISOString(),
  };
}

/** 링크 행을 만든다. 같은 주문이면 그대로 둔다(재시도·대사에서 여러 번 불려도 안전). */
export async function ensureGiftLink(supabaseUrl, serviceKey, order, orderId, env = process.env, fetchImpl = fetch) {
  const row = giftRowFromOrder(order, orderId, new Date(), env);
  if (!row.code) return { ok: false, reason: "gift_secret_missing" };
  try {
    const r = await fetchImpl(`${supabaseUrl}/rest/v1/gift_links?on_conflict=code`, {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(row),
    });
    return r.ok ? { ok: true, code: row.code } : { ok: false, reason: `gift_link_${r.status}` };
  } catch {
    return { ok: false, reason: "gift_link_exception" };
  }
}

/** 받는 분이 처음 받는 문자. 모르는 번호로 온 링크라 첫 줄에 보낸 분 이름을 쓴다. */
export function giftRecipientText(order, url) {
  const from = clean(order.senderName, 20) || "아는 분";
  return [
    `[꽃안부] ${from}님이 ${clean(order.recipientName, 20) || "고객"}님께 꽃을 보내셨어요.`,
    "",
    "받으실 주소와 날짜를 아래 링크에 넣어 주세요.",
    url,
    "",
    `${GIFT_DAYS}일 안에 넣어 주시면 됩니다.`,
    "문의 1577-2286",
  ].join("\n");
}

/** 결제 직후 보내는 분에게. 링크를 카톡으로 한 번 더 보내 달라고 안내한다. */
export function giftSenderPaidText(order, payment, url) {
  return [
    "[꽃안부] 꽃 선물 결제가 끝났어요.",
    "",
    `상품: ${order.productLabel || "-"}`,
    `받는 분: ${order.recipientName || "-"}`,
    `결제금액: ${won(payment.totalAmount)}`,
    `주문번호: ${payment.orderId}`,
    "",
    "받는 분께 주소를 넣는 링크를 문자로 보냈어요. 아는 분이 보낸 카톡이면 더 믿고 여시니까 아래 링크를 카톡으로도 보내 주세요.",
    url,
    "",
    `${GIFT_DAYS}일 안에 주소가 들어오지 않으면 전액 환불해 드려요. 먼 지역이면 추가 배송비를 따로 알려 드려요.`,
    "문의 1577-2286",
  ].join("\n");
}

/** 결제 직후 사장님 텔레그램. 아직 만들면 안 된다는 게 핵심이다. */
export function giftOwnerWaitingText(order, payment) {
  return [
    "🎁 선물 결제 · 받는 분 주소 기다리는 중",
    "",
    `상품: ${order.productLabel || "-"}`,
    `결제금액: ${won(payment.totalAmount)}`,
    `보낸 분: ${order.senderName || "-"} ${order.senderPhone || ""}`.trim(),
    `받는 분: ${order.recipientName || "-"}`,
    `주문번호: ${payment.orderId}`,
    "",
    `아직 만들지 마세요. 받는 분이 주소를 넣으면 평소처럼 주문 알림이 다시 와요. ${GIFT_DAYS}일 안에 안 넣으면 자동으로 환불돼요.`,
  ].join("\n");
}

// ── 받는 분이 주소를 넣은 뒤 ─────────────────────────────────────────

const slotLabel = (k) => SLOTS[k] || "";
const kstMidnightIso = (date) => {
  const t = new Date(`${date}T00:00:00+09:00`);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
};

// 먼 지역 추가 배송비 결제 링크. admin.js 맞춤 결제 링크와 같은 서명(pay:v2:…)이다.
// 주문번호는 선물 주문에서 만들어서, 주소를 몇 번 고쳐도 링크가 하나로 남는다.
export function extraFeeLink(orderId, amount, env = process.env) {
  const secret = env.CRON_SECRET || env.TOSS_SECRET_KEY || "";
  if (!secret || !(amount > 0)) return null;
  const tail = crypto.createHmac("sha256", secret).update(`giftfee:${orderId}`).digest("hex").slice(0, 8).toUpperCase();
  const ymd = String(orderId).slice(3, 11);
  const oid = `AFC${ymd}-${tail}`;
  const label = "선물 추가 배송비";
  const t = crypto.createHmac("sha256", secret).update(`pay:v2:${oid}:${amount}:${label}`).digest("hex").slice(0, 32);
  return { orderId: oid, url: `${baseUrl(env)}/pay.html?oid=${oid}&amt=${amount}&t=${t}&label=${encodeURIComponent(label)}` };
}

export function giftSenderFilledText(row, value, fee) {
  const L = [
    `[꽃안부] ${row.recipient_name || "받는 분"}님이 받으실 주소를 넣으셨어요.`,
    "",
    `도착 예정: ${value.deliver_date} ${slotLabel(value.deliver_slot)}`,
    "주소는 받는 분 정보라 저희만 보고 배달에만 씁니다.",
  ];
  if (fee) {
    L.push("", `주소가 먼 지역이라 추가 배송비 ${won(value.extra_fee)}이 있어요. 아래 링크로 결제해 주시면 바로 준비할게요.`, fee.url);
  }
  L.push("", "도착하면 사진을 이 번호로 보내 드려요.", "문의 1577-2286");
  return L.join("\n");
}

// order_data(결제 때 봉인한 주문 원본)를 읽는다. 사장님 알림을 결제 때와 같은 재료로 만들기 위해서다.
async function loadOrderData(s, orderId) {
  const r = await fetch(`${s.url}/rest/v1/payment_intents?order_id=eq.${encodeURIComponent(orderId)}&select=order_data&limit=1`, { headers: s.headers }).catch(() => null);
  if (!r || !r.ok) return null;
  const rows = await r.json().catch(() => []);
  return (rows[0] && rows[0].order_data) || null;
}
async function loadOrderRow(s, orderId) {
  const r = await fetch(`${s.url}/rest/v1/orders?order_id=eq.${encodeURIComponent(orderId)}&select=order_id,status,amount,paid_amount,payment_method,product_label,product_code,recipient_name,sender_name,sender_phone,note,completed_at,cancel_requested_at&limit=1`, { headers: s.headers }).catch(() => null);
  if (!r || !r.ok) return { error: true };
  const rows = await r.json().catch(() => []);
  return { row: rows[0] || null };
}

/**
 * 주소를 주문 원장에 옮기고 접수로 넘긴다. 이때 보내는 분 계정에서 주문을 떼어 낸다(user_id 비움).
 * 회원은 자기 주문 행을 직접 읽을 수 있어서, 그대로 두면 받는 분 주소가 보내는 분에게 보인다.
 * 보낸 선물 목록은 결제 원본(payment_intents)의 user_id 로 따로 찾는다.
 */
async function applyFillToOrder(s, row, value, orderData) {
  const place = [value.address, value.address_detail].filter(Boolean).join(" ");
  const fee = value.extra_fee > 0 ? `[추가 배송비 ${won(value.extra_fee)} · 보내는 분께 결제 링크 문자 보냄] ` : "";
  const baseNote = String((orderData && orderData.cardMessage) ? `[카드] ${orderData.cardMessage}` : "");
  const note = `[🎁 선물 · 받는 분이 주소 입력] ${fee}${value.delivery_note ? `[배송 요청 ${value.delivery_note}] ` : ""}${baseNote}${orderData && orderData.senderNote ? ` ${orderData.senderNote}` : ""}`.trim();
  const patch = {
    status: "new",
    address: place,
    recipient_phone: value.filled_phone,
    event_date: value.deliver_date,
    event_time: slotLabel(value.deliver_slot),
    delivery_time_slot: value.deliver_slot,
    event_at: kstMidnightIso(value.deliver_date),
    note,
    user_id: null,
    alerted_at: null,
  };
  const r = await fetch(`${s.url}/rest/v1/orders?order_id=eq.${encodeURIComponent(row.order_id)}&status=in.(${GIFT_WAIT},new)&cancel_requested_at=is.null&select=order_id`, {
    method: "PATCH", headers: { ...s.headers, "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(patch),
  }).catch(() => null);
  if (!r || !r.ok) return false;
  const saved = await r.json().catch(() => []);
  return Array.isArray(saved) && saved.length > 0;
}

/** 주소가 들어온 뒤 사장님 알림 재료. 결제 때 원본에 받는 분이 넣은 값을 덮는다. */
export function filledOrderForNotice(orderData, orderRow, value, { first }) {
  return {
    ...(orderData || {}),
    productLabel: (orderData && orderData.productLabel) || (orderRow && orderRow.product_label) || "",
    recipientName: (orderData && orderData.recipientName) || (orderRow && orderRow.recipient_name) || "",
    senderName: (orderData && orderData.senderName) || (orderRow && orderRow.sender_name) || "",
    senderPhone: (orderData && orderData.senderPhone) || (orderRow && orderRow.sender_phone) || "",
    gift: true,
    giftFilled: first ? "new" : "edited",
    giftExtraFee: value.extra_fee || 0,
    address: [value.address, value.address_detail].filter(Boolean).join(" "),
    venue: "", venueDetail: "", venueAddress: "",
    recipientPhone: value.filled_phone,
    date: value.deliver_date,
    time: slotLabel(value.deliver_slot),
    timeSlot: value.deliver_slot,
    delivReq: value.delivery_note || "",
    entrancePw: "",
  };
}

// ── 환불 ─────────────────────────────────────────────────────────────

/**
 * 텔레그램 '💸 결제취소(환불)' 버튼과 같은 길(api/admin.js 의 order·cancel)을 서버 안에서 부른다.
 * 돈이 나가는 새 경로를 만들지 않기 위해서다. 토스 취소·멱등키·대사 재시도·발주 잠금이 전부 그쪽에 있다.
 */
export async function refundGiftOrder(orderId, reason, env = process.env) {
  const rs = env.REFUND_LINK_SECRET;
  if (!rs) return { ok: false, reason: "refund_secret_missing" };
  const d = new Date(Date.now() + 9 * 3600000);
  const ym = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const token = crypto.createHmac("sha256", rs).update(`cancel:${orderId}:${ym}`).digest("hex").slice(0, 24);
  const { default: admin } = await import("../api/admin.js");
  const out = { status: 200, body: null };
  const res = {
    setHeader() {}, getHeader() {}, end() { return res; },
    status(c) { out.status = c; return res; },
    json(b) { out.body = b; return res; },
  };
  const req = { method: "POST", headers: {}, query: {}, body: { resource: "order", action: "cancel", orderId, token, reason: clean(reason, 80) } };
  try { await admin(req, res); } catch { return { ok: false, reason: "refund_exception" }; }
  return { ok: out.status === 200 || out.status === 202, pending: out.status === 202, status: out.status, error: out.body && out.body.error };
}

async function tg(text, env) {
  const t = env.TELEGRAM_BOT_TOKEN, c = env.TELEGRAM_CHAT_ID;
  if (!t || !c) return false;
  const tag = env.PROJECT_TAG ? `[${env.PROJECT_TAG}] ` : "";
  const r = await fetch(`https://api.telegram.org/bot${t}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: c, text: tag + text, disable_web_page_preview: true }),
  }).catch(() => null);
  return !!(r && r.ok);
}
const sms = (to, text, subject, env) => sendTransactionalText({ to, text, subject, env }).catch(() => ({ sent: false }));

/** 받는 분이 거절했거나, 기한이 지났거나, 보내는 분이 취소했을 때. 링크 상태는 이미 바뀐 뒤에 부른다. */
async function closeAndRefund(s, row, why, env) {
  const { row: order } = await loadOrderRow(s, row.order_id);
  // 사장님이 주문 관리에서 이미 환불했으면 다시 하지 않는다(문자도 두 번 가지 않게).
  if (order && (order.status === "canceled" || order.cancel_requested_at)) return { ok: true, already: true };
  const label = (order && order.product_label) || row.product_label || "꽃 선물";
  const refund = await refundGiftOrder(row.order_id, `선물 ${why}`, env);
  const senderPhone = order && order.sender_phone;
  const reasonLine = why === "거절" ? `${row.recipient_name || "받는 분"}님이 받기 어렵다고 하셔서`
    : why === "기한" ? `${GIFT_DAYS}일 동안 주소가 들어오지 않아서`
    : "선물을 취소하셔서";
  if (refund.ok) {
    if (senderPhone) await sms(senderPhone, `[꽃안부] ${reasonLine} ${label} 결제를 전액 취소했어요.\n카드사에 따라 3~5일 안에 돌아갑니다.\n주문번호: ${row.order_id}\n문의 1577-2286`, "꽃안부 환불 안내", env);
    await tg(`🎁 선물 환불 (${why})\n${label} · ${row.order_id}\n보낸 분 ${(order && order.sender_name) || ""} ${senderPhone || ""}`.trim(), env);
  } else {
    await tg(`🚨 선물 환불을 자동으로 못 했어요 (${why})\n${label} · ${row.order_id}\n주문 관리에서 환불을 눌러 주세요. 보낸 분 ${(order && order.sender_name) || ""} ${senderPhone || ""}`.trim(), env);
  }
  return refund;
}

// ── 받는 분 링크(POST) 이후 처리 ────────────────────────────────────────

/** handleGiftPost 가 저장에 성공한 뒤 부른다. deps.notifyOwners / notifyTelegram 은 confirm-payment.js 것. */
export async function afterGiftFill(row, value, { first }, deps = {}, env = process.env) {
  const s = sb(env);
  const [orderData, { row: orderRow }] = await Promise.all([loadOrderData(s, row.order_id), loadOrderRow(s, row.order_id)]);
  const applied = await applyFillToOrder(s, row, value, orderData);
  if (!applied) return { ok: false };
  const fee = value.extra_fee > 0 ? extraFeeLink(row.order_id, value.extra_fee, env) : null;
  const order = filledOrderForNotice(orderData, orderRow, value, { first });
  const payment = { orderId: row.order_id, totalAmount: orderRow && (orderRow.paid_amount || orderRow.amount), method: orderRow && orderRow.payment_method };
  const jobs = [];
  if (deps.notifyTelegram) jobs.push(deps.notifyTelegram(order, payment));
  if (deps.notifyOwners) jobs.push(deps.notifyOwners(order, payment, { includeCustomer: false, includeOwners: true }));
  if (first && order.senderPhone) jobs.push(sms(order.senderPhone, giftSenderFilledText(row, value, fee), "꽃안부 선물 안내", env));
  await Promise.all(jobs.map((p) => Promise.resolve(p).catch(() => null)));
  return { ok: true };
}

export async function afterGiftDecline(row, env = process.env) {
  return closeAndRefund(sb(env), row, "거절", env);
}

// ── 보내는 분(내 정보 → 보낸 선물) ──────────────────────────────────────

async function userOf(req, env) {
  const m = String((req.headers && (req.headers.authorization || req.headers.Authorization)) || "").match(/^Bearer\s+(.+)$/i);
  if (!m || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${m[1]}` } }).catch(() => null);
  if (!r || !r.ok) return null;
  const u = await r.json().catch(() => null);
  return u && u.id ? u.id : null;
}

// 결제 원본에서 이 회원이 낸 선물 주문번호를 찾는다. 주소가 들어오면 orders.user_id 는 비워지므로 여기서만 찾을 수 있다.
async function myGiftOrderIds(s, uid) {
  const r = await fetch(`${s.url}/rest/v1/payment_intents?order_id=like.AFG*&order_data->>user_id=eq.${encodeURIComponent(uid)}&state=in.(paid,finalized,canceling,canceled)&select=order_id&order=created_at.desc&limit=30`, { headers: s.headers }).catch(() => null);
  if (!r || !r.ok) return null;
  const rows = await r.json().catch(() => []);
  return rows.map((x) => x.order_id).filter((id) => GIFT_ORDER_RE.test(id));
}

/** 보낸 선물 목록. 받는 분 주소·받는 분이 고친 번호는 여기서도 내보내지 않는다. */
export async function handleGiftSenderGet(req, env = process.env) {
  const s = sb(env);
  if (!s) return { status: 503, json: { error: "잠시 후 다시 시도해 주세요." } };
  const uid = await userOf(req, env);
  if (!uid) return { status: 401, json: { error: "로그인이 필요해요." } };
  const ids = await myGiftOrderIds(s, uid);
  if (!ids) return { status: 503, json: { error: "잠시 후 다시 시도해 주세요." } };
  if (!ids.length) return { status: 200, json: { gifts: [] } };
  const list = ids.map(encodeURIComponent).join(",");
  const [gr, or] = await Promise.all([
    fetch(`${s.url}/rest/v1/gift_links?order_id=in.(${list})&select=code,order_id,status,recipient_name,recipient_phone,product_label,product_photo,expires_at,deliver_date,deliver_slot,extra_fee,created_at`, { headers: s.headers }).catch(() => null),
    fetch(`${s.url}/rest/v1/orders?order_id=in.(${list})&select=order_id,status,paid_amount,amount,completed_at,cancel_requested_at`, { headers: s.headers }).catch(() => null),
  ]);
  if (!gr || !gr.ok || !or || !or.ok) return { status: 503, json: { error: "잠시 후 다시 시도해 주세요." } };
  const links = await gr.json().catch(() => []), orders = await or.json().catch(() => []);
  const now = new Date();
  const gifts = links.map((g) => {
    const o = orders.find((x) => x.order_id === g.order_id) || {};
    const status = o.cancel_requested_at && o.status !== "delivered" ? "canceled" : (o.completed_at ? "delivered" : o.status);
    const stage = giftStage(g, now, status);
    return {
      orderId: g.order_id, stage, to: g.recipient_name, product: g.product_label || "", photo: g.product_photo || "",
      amount: o.paid_amount || o.amount || 0, created: g.created_at,
      ...(stage === "wait" ? { phone: g.recipient_phone, until: g.expires_at, url: giftUrl(g.code, env) } : {}),
      ...(["got", "checking", "preparing", "delivered"].includes(stage) ? { date: g.deliver_date || "", slot: slotLabel(g.deliver_slot) } : {}),
    };
  }).sort((a, b) => String(b.created).localeCompare(String(a.created)));
  return { status: 200, json: { gifts } };
}

// 같은 함수 인스턴스 안에서 링크 문자 다시 보내기를 10분에 한 번으로 막는다(문자 요금·스팸).
const RESENT = new Map();

/** 보낸 선물: 링크 다시 보내기 · 받는 분 번호 고치기 · 주소 전 취소. */
export async function handleGiftSenderPost(req, body, env = process.env) {
  const s = sb(env);
  if (!s) return { status: 503, json: { error: "잠시 후 다시 시도해 주세요." } };
  const uid = await userOf(req, env);
  if (!uid) return { status: 401, json: { error: "로그인이 필요해요." } };
  const orderId = String(body.orderId || "");
  if (!GIFT_ORDER_RE.test(orderId)) return { status: 400, json: { error: "잘못된 요청이에요." } };
  const ids = await myGiftOrderIds(s, uid);
  if (!ids) return { status: 503, json: { error: "잠시 후 다시 시도해 주세요." } };
  if (!ids.includes(orderId)) return { status: 404, json: { error: "보낸 선물을 찾지 못했어요." } };
  const { row, error } = await loadGift(s, giftCodeFor(orderId, env));
  if (error || !row) return { status: 503, json: { error: "잠시 후 다시 시도해 주세요." } };
  const { row: order } = await loadOrderRow(s, orderId);
  const stage = giftStage(row, new Date(), order ? order.status : "");
  if (stage !== "wait") return { status: 409, json: { error: "받는 분이 이미 주소를 넣었거나 끝난 선물이에요. 1577-2286으로 전화 주세요." } };
  const patch = (fields) => fetch(`${s.url}/rest/v1/gift_links?code=eq.${row.code}&status=eq.waiting`, {
    method: "PATCH", headers: { ...s.headers, "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(fields),
  }).then((r) => (r.ok ? r.json() : [])).then((x) => (Array.isArray(x) ? x[0] : null)).catch(() => null);
  const linkText = () => giftRecipientText({ senderName: row.sender_name, recipientName: row.recipient_name }, giftUrl(row.code, env));

  if (body.action === "resend" || body.action === "phone") {
    let to = row.recipient_phone;
    if (body.action === "phone") {
      to = digits(body.phone);
      if (!isMobile(to)) return { status: 400, json: { error: "휴대폰 번호를 확인해 주세요." } };
      const saved = await patch({ recipient_phone: to });
      if (!saved) return { status: 409, json: { error: "잠시 후 다시 시도해 주세요." } };
    } else {
      const last = RESENT.get(orderId) || 0;
      if (Date.now() - last < 10 * 60000) return { status: 429, json: { error: "방금 보냈어요. 10분 뒤에 다시 보낼 수 있어요." } };
    }
    RESENT.set(orderId, Date.now());
    const sent = await sms(to, linkText(), "꽃안부 꽃 선물", env);
    return sent.sent ? { status: 200, json: { ok: true } } : { status: 502, json: { error: "문자를 보내지 못했어요. 링크를 복사해서 직접 보내 주세요." } };
  }
  if (body.action === "cancel") {
    const saved = await patch({ status: "canceled" });
    if (!saved) return { status: 409, json: { error: "받는 분이 방금 주소를 넣었을 수 있어요. 1577-2286으로 전화 주세요." } };
    const refund = await closeAndRefund(s, row, "취소", env);
    return { status: 200, json: { ok: true, refunded: !!refund.ok } };
  }
  return { status: 400, json: { error: "잘못된 요청이에요." } };
}

// ── 매일 아침 점검 ───────────────────────────────────────────────────

/**
 * check-deadlines 아침 브리핑에서 하루 한 번 부른다.
 * 1) 3일째: 받는 분에게 한 번 더 문자, 보내는 분에게도 알림 (만든 지 3~4일 사이 = 하루 한 번만 걸린다)
 * 2) 기한 지남: 링크를 닫고 전액 환불
 * 3) 주소는 들어왔는데 주문이 아직 '주소 대기'면 사장님께 알림(주문 옮기기가 실패한 경우)
 */
export async function sweepGifts(env = process.env, now = new Date()) {
  const s = sb(env);
  if (!s) return { ok: false, reason: "supabase_env_missing" };
  const out = { reminded: 0, expired: 0, stuck: 0 };
  const iso = (ms) => new Date(now.getTime() - ms).toISOString();
  const get = async (q) => {
    const r = await fetch(`${s.url}/rest/v1/gift_links?${q}`, { headers: s.headers }).catch(() => null);
    return r && r.ok ? (await r.json().catch(() => [])) : [];
  };
  const remind = await get(`status=eq.waiting&created_at=lt.${encodeURIComponent(iso(GIFT_REMIND_DAYS * 86400000))}&created_at=gte.${encodeURIComponent(iso((GIFT_REMIND_DAYS + 1) * 86400000))}&select=*`);
  for (const g of remind) {
    if (new Date(g.expires_at) <= now) continue;
    const { row: order } = await loadOrderRow(s, g.order_id);
    if (!order || order.status !== GIFT_WAIT || order.cancel_requested_at) continue;
    await sms(g.recipient_phone, giftRecipientText({ senderName: g.sender_name, recipientName: g.recipient_name }, giftUrl(g.code, env)), "꽃안부 꽃 선물", env);
    if (order.sender_phone) {
      await sms(order.sender_phone, `[꽃안부] ${g.recipient_name || "받는 분"}님이 아직 주소를 넣지 않으셨어요. 받는 분께 링크를 한 번 더 보냈어요.\n카톡으로도 한 번 알려 주시면 좋아요.\n${giftUrl(g.code, env)}\n${GIFT_DAYS}일이 지나면 전액 환불해 드려요.`, "꽃안부 선물 안내", env);
    }
    out.reminded++;
  }
  const expired = await get(`status=eq.waiting&expires_at=lt.${encodeURIComponent(now.toISOString())}&select=*&limit=20`);
  for (const g of expired) {
    const r = await fetch(`${s.url}/rest/v1/gift_links?code=eq.${g.code}&status=eq.waiting`, {
      method: "PATCH", headers: { ...s.headers, "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify({ status: "expired" }),
    }).catch(() => null);
    const saved = r && r.ok ? await r.json().catch(() => []) : [];
    if (!saved[0]) continue;
    await closeAndRefund(s, g, "기한", env);
    out.expired++;
  }
  const filled = await get(`status=eq.filled&select=code,order_id,recipient_name,product_label&limit=50`);
  if (filled.length) {
    const list = filled.map((g) => encodeURIComponent(g.order_id)).join(",");
    const r = await fetch(`${s.url}/rest/v1/orders?order_id=in.(${list})&status=eq.${GIFT_WAIT}&select=order_id`, { headers: s.headers }).catch(() => null);
    const stuck = r && r.ok ? await r.json().catch(() => []) : [];
    if (stuck.length) {
      out.stuck = stuck.length;
      await tg(`🚨 선물 주소는 들어왔는데 주문이 아직 '주소 대기'예요\n${stuck.map((x) => x.order_id).join("\n")}\n형구에게 알려 주세요.`, env);
    }
  }
  return { ok: true, ...out };
}
