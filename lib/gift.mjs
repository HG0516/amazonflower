// 주소 없는 꽃 선물(11/2). 보내는 분이 먼저 결제하고, 받는 분이 링크(/g/<code>)에서 주소를 넣는다.
// ⚠️ 보내는 분도 같은 링크를 갖고 있다. 그래서 링크를 다시 열 때 주소를 절대 돌려주지 않는다(giftPublicView).
//    고칠 때도 예전 값을 보여 주지 않고 새로 받는다.
import crypto from "node:crypto";
import "../regions.js";

export const GIFT_DAYS = 7;
export const GIFT_CODE_RE = /^[A-Za-z0-9]{10}$/;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";   // 헷갈리는 글자(O0Il1)는 뺐다
const SLOTS = { am: "오전중", pm: "오후중", today: "당일중" };
// index.html 의 AF_CUTOFF_WEEKDAY·WEEKEND 와 같은 값으로 맞출 것
const CUTOFF_WEEKDAY = 18, CUTOFF_WEEKEND = 16;

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
  if (row.status === "canceled") return "closed";
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

export async function handleGiftPost(body, env = process.env) {
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
    return saved[0] ? { status: 200, json: { ok: true } } : { status: 409, json: { error: "1577-2286으로 전화 주세요." } };
  }
  if (body.action !== "fill") return { status: 400, json: { error: "잘못된 요청이에요." } };
  if (stage !== "wait" && stage !== "got" && stage !== "checking") return { status: 409, json: { error: "주소를 고치려면 1577-2286으로 전화 주세요." } };
  const checked = checkGiftFill(body, now);
  if (checked.error) return { status: 400, json: { error: checked.error, blocked: !!checked.blocked } };
  const r = await patch({ ...checked.value, status: "filled", filled_at: now.toISOString(), consent_at: now.toISOString() }, "status=in.(waiting,filled)");
  const saved = r.ok ? await r.json().catch(() => []) : [];
  if (!saved[0]) return { status: 409, json: { error: "잠시 후 다시 시도해 주세요." } };
  return { status: 200, json: { ok: true, stage: checked.value.extra_fee > 0 ? "checking" : "got", date: checked.value.deliver_date, slot: SLOTS[checked.value.deliver_slot] } };
}
