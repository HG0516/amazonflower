// 보낸 꽃 사진(2026-10-29) — 아버지가 텔레그램 주문 알림 방에 올린 사진, 관리 화면에서 여러 장 올린 사진,
// 주문 배송완료 사진을 후보함(sent_photos, status=pending)에 모은다. supabase-sent-photos.sql.
// - 원본(리본 이름 그대로)은 비공개 order-photos 버킷의 sent-raw/ 아래. 배송완료 사진은 원래 자리 그대로 가리킨다.
// - 공개본은 관리자가 리본 이름을 가리고 [공개]를 누를 때 gallery 버킷 sent/ 아래에 새로 만든다.
// - 손님 화면은 status=shown 인 줄의 공개 칸만 anon 으로 읽는다(원본 경로·주문번호·메모는 못 읽음).
import crypto from "node:crypto";
import { PRODUCTS } from "../products.mjs";

export const RAW_BUCKET = "order-photos";
export const RAW_PREFIX = "sent-raw/";
export const SENT_CATS = ["congrats", "condolence", "orchid", "plant", "basket", "bouquet"];
export const MAX_BYTES = 3 * 1024 * 1024; // order-photos 버킷 한도와 같다
const BY_PC = new Map(PRODUCTS.map((p) => [p.pc, p]));

export function cleanText(s, n) {
  return String(s == null ? "" : s).replace(/[\u0000-\u001f<>"'`\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
}

// 텔레그램이 웹후크에 실어 보내는 비밀값. 봇 토큰에서 만들어 새 env 없이 쓴다.
export function webhookSecret(token) {
  return crypto.createHash("sha256").update(`floweranbu-sent-photos:${token}`).digest("hex").slice(0, 48);
}
export function secretMatches(got, want) {
  const a = Buffer.from(String(got || "")), b = Buffer.from(String(want || ""));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}
export function webhookUrl(origin) {
  return `${String(origin || "https://floweranbu.co.kr").replace(/\/+$/, "")}/api/gallery-add?tg=1`;
}

// 주문 알림 본문의 '주문번호: AF…' 줄(confirm-payment buildOwnerMessage).
export function orderIdFromAlarm(text) {
  const m = String(text || "").match(/주문번호:\s*([A-Za-z0-9._-]{4,64})/);
  return m ? m[1] : "";
}

export function kstDate(ms) {
  const d = new Date((Number.isFinite(ms) ? ms : Date.now()) + 9 * 3600000);
  return d.toISOString().slice(0, 10);
}

// 사진 설명에 붙일 동네. 특별·광역시는 구·군, 도는 시·군까지만(번지·건물은 안 씀).
export function areaOf(address) {
  const t = String(address || "").replace(/^\[\d{5}\]\s*/, "").replace(/\([^)]*\)/g, " ").trim().split(/\s+/);
  if (!t[0]) return "";
  if (/^세종/.test(t[0])) return "세종시";
  const metro = /^(서울|부산|대구|인천|광주|대전|울산)/.test(t[0]);
  const want = metro ? /^[가-힣]{1,6}[구군]$/ : /^[가-힣]{1,6}[시군]$/;
  return t.slice(1, 4).find((x) => want.test(x)) || "";
}

// 주문에서 상품·종류·이름·동네를 따온다. 근조는 동네를 붙이지 않는다(장례식장·고인을 짐작할 수 있음).
export function fromOrder(o) {
  const p = BY_PC.get(String(o && o.product_code || ""));
  const funeral = (o && o.order_type === "funeral") || (p && p.cat === "condolence");
  const title = p ? [p.name, p.subtitle].filter(Boolean).join(" · ") : (o && o.product_label) || "";
  return {
    product_code: (o && o.product_code) || null,
    category: p ? p.cat : (funeral ? "condolence" : null),
    title: cleanText(title, 60) || null,
    area: funeral ? null : (areaOf(o && o.address) || null),
  };
}

// 텔레그램 update 에서 받을 사진 하나를 고른다. 받을 것이 아니면 { skip }.
// 알림 방(TELEGRAM_CHAT_ID) 밖에서 온 것은 전부 버린다.
export function pickTelegramPhoto(update, allowedChatId) {
  const msg = update && update.message;
  if (!msg || !msg.chat) return { skip: "no_message" };
  if (!String(allowedChatId || "").trim() || String(msg.chat.id) !== String(allowedChatId).trim()) return { skip: "other_chat" };
  let file = null, bad = "";
  if (Array.isArray(msg.photo) && msg.photo.length) {
    const fits = msg.photo.filter((p) => p && p.file_id && (!p.file_size || p.file_size <= MAX_BYTES));
    fits.sort((a, b) => (b.width * b.height) - (a.width * a.height));
    if (fits[0]) file = fits[0]; else bad = "too_big";
  } else if (msg.document && /^image\//i.test(msg.document.mime_type || "")) {
    if (!/^image\/jpe?g$/i.test(msg.document.mime_type)) bad = "not_jpeg";
    else if (msg.document.file_size && msg.document.file_size > MAX_BYTES) bad = "too_big";
    else file = msg.document;
  } else {
    return { skip: "no_photo" };
  }
  const reply = msg.reply_to_message;
  return {
    chatId: msg.chat.id,
    messageId: msg.message_id,
    groupId: msg.media_group_id ? String(msg.media_group_id) : "",
    fileId: file ? file.file_id : "",
    bad,
    caption: cleanText(msg.caption, 200),
    orderId: reply && reply.from && reply.from.is_bot ? orderIdFromAlarm(reply.text || reply.caption) : "",
    date: Number(msg.date) * 1000,
  };
}

export async function tgCall(token, method, payload, ms = 5000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
      signal: ac.signal,
    });
    const d = await r.json().catch(() => null);
    if (d && d.ok) return { ok: true, result: d.result };
    return { ok: false, status: r.status, description: d && d.description ? String(d.description).slice(0, 200) : "" };
  } catch (e) {
    return { ok: false, status: 0, description: e && e.name === "AbortError" ? "timeout" : "network" };
  } finally { clearTimeout(timer); }
}

export function decodeJpegBase64(b64) {
  if (typeof b64 !== "string" || !b64 || b64.length > 4_000_000) return { err: "사진 용량이 큽니다. 더 작게 올려 주세요." };
  let buf;
  try { buf = Buffer.from(b64.replace(/^data:image\/\w+;base64,/, ""), "base64"); } catch { return { err: "사진 데이터를 읽을 수 없습니다." }; }
  return checkJpeg(buf);
}
function checkJpeg(buf) {
  if (!buf || !buf.length || buf.length > MAX_BYTES) return { err: "사진 용량이 큽니다. (3MB 이하)" };
  if (!(buf[0] === 0xFF && buf[1] === 0xD8)) return { err: "JPG 사진만 받을 수 있어요." };
  return { buf };
}

export async function tgDownload(token, fileId) {
  const f = await tgCall(token, "getFile", { file_id: fileId });
  if (!f.ok || !f.result || !f.result.file_path) return { err: "getFile" };
  if (f.result.file_size && f.result.file_size > MAX_BYTES) return { err: "too_big" };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  try {
    const r = await fetch(`https://api.telegram.org/file/bot${token}/${f.result.file_path}`, { signal: ac.signal });
    if (!r.ok) return { err: "download" };
    const c = checkJpeg(Buffer.from(await r.arrayBuffer()));
    return c.err ? { err: "not_jpeg" } : c;
  } catch { return { err: "download" }; }
  finally { clearTimeout(timer); }
}

const svc = (key) => ({ apikey: key, Authorization: `Bearer ${key}` });

export async function putRaw(supabaseUrl, serviceKey, buf) {
  const month = kstDate(Date.now()).slice(0, 7);
  const path = `${RAW_PREFIX}${month}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.jpg`;
  try {
    const up = await fetch(`${supabaseUrl}/storage/v1/object/${RAW_BUCKET}/${path}`, {
      method: "POST", headers: { ...svc(serviceKey), "Content-Type": "image/jpeg" }, body: buf,
    });
    return up.ok ? { path } : { err: `storage_${up.status}` };
  } catch { return { err: "storage" }; }
}
// 우리가 만든 sent-raw/ 원본만 지운다. 배송완료 사진(주문 원본)은 절대 안 지운다.
export async function dropRaw(supabaseUrl, serviceKey, path) {
  const p = String(path || "");
  if (!p.startsWith(RAW_PREFIX) || p.includes("..")) return false;
  try {
    const r = await fetch(`${supabaseUrl}/storage/v1/object/${RAW_BUCKET}/${p}`, { method: "DELETE", headers: svc(serviceKey) });
    return r.ok || r.status === 404;
  } catch { return false; }
}
export async function readRaw(supabaseUrl, serviceKey, path) {
  const p = String(path || "").replace(/^\/+/, "");
  if (!p || p.includes("..")) return null;
  try {
    const r = await fetch(`${supabaseUrl}/storage/v1/object/${RAW_BUCKET}/${encodeURI(p)}`, { headers: svc(serviceKey) });
    if (!r.ok) return null;
    const c = checkJpeg(Buffer.from(await r.arrayBuffer()));
    return c.buf || null;
  } catch { return null; }
}
// 관리 화면 미리보기용 서명 주소(1시간). { 경로: 주소 }
export async function signRaw(supabaseUrl, serviceKey, paths) {
  const list = [...new Set(paths.filter(Boolean).map(String))];
  if (!list.length) return {};
  try {
    const r = await fetch(`${supabaseUrl}/storage/v1/object/sign/${RAW_BUCKET}`, {
      method: "POST", headers: { ...svc(serviceKey), "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: 3600, paths: list }),
    });
    const rows = r.ok ? await r.json().catch(() => []) : [];
    const out = {};
    for (const x of Array.isArray(rows) ? rows : []) {
      if (x && x.path && x.signedURL && !x.error) out[x.path] = `${supabaseUrl}/storage/v1${x.signedURL}`;
    }
    return out;
  } catch { return {}; }
}

// 최근 30일 배송완료 사진 중 아직 후보함에 없는 것을 넣는다(관리 화면을 열 때). 주문·문자 코드는 건드리지 않는다.
export async function importOrderPhotos(supabaseUrl, serviceKey, days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const r = await fetch(`${supabaseUrl}/rest/v1/orders?select=order_id,order_type,product_code,product_label,address,completed_photo,completed_at`
    + `&completed_photo=not.is.null&completed_at=gte.${encodeURIComponent(since)}&order=completed_at.desc&limit=60`, { headers: svc(serviceKey) });
  if (!r.ok) return 0;
  const orders = (await r.json().catch(() => [])).filter((o) => o && o.order_id && o.completed_photo && !/^https?:/i.test(o.completed_photo));
  if (!orders.length) return 0;
  const inList = orders.map((o) => `"${String(o.order_id).replace(/"/g, "")}"`).join(",");
  const h = await fetch(`${supabaseUrl}/rest/v1/sent_photos?select=order_id&source=eq.order&order_id=in.(${encodeURIComponent(inList)})`, { headers: svc(serviceKey) });
  if (!h.ok) return 0;
  const have = new Set((await h.json().catch(() => [])).map((x) => x.order_id));
  const rows = orders.filter((o) => !have.has(o.order_id)).map((o) => ({
    status: "pending", source: "order", raw_path: String(o.completed_photo).replace(/^\/+/, ""), order_id: o.order_id,
    ...fromOrder(o), shot_on: kstDate(Date.parse(o.completed_at)),
  }));
  if (!rows.length) return 0;
  const ins = await fetch(`${supabaseUrl}/rest/v1/sent_photos`, {
    method: "POST", headers: { ...svc(serviceKey), "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(rows),
  });
  return ins.ok ? rows.length : 0;
}

// 텔레그램 웹후크 본체. 언제나 200 계열로 끝내 텔레그램이 같은 사진을 계속 다시 보내지 않게 한다(비밀값 틀림만 401).
export async function handleTelegramWebhook({ headers, body, env }) {
  const token = env.TELEGRAM_BOT_TOKEN, chat = env.TELEGRAM_CHAT_ID;
  const su = env.SUPABASE_URL, sk = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!token || !chat || !su || !sk) return { status: 503, skip: "env" };
  const got = headers && (headers["x-telegram-bot-api-secret-token"] || headers["X-Telegram-Bot-Api-Secret-Token"]);
  if (!secretMatches(got, webhookSecret(token))) return { status: 401, skip: "secret" };
  const pick = pickTelegramPhoto(body, chat);
  if (pick.skip) return { status: 200, skip: pick.skip };
  const say = (text) => tgCall(token, "sendMessage", {
    chat_id: pick.chatId, text, reply_to_message_id: pick.messageId, allow_sending_without_reply: true, disable_notification: true,
  });
  const FAIL = "사진을 못 받았어요. 한 번만 다시 보내 주세요.";
  if (pick.bad) {
    await say(pick.bad === "not_jpeg" ? "이 사진은 받을 수 없어요. 파일 말고 사진으로 보내 주세요." : "사진이 너무 커요. 사진으로 다시 보내 주세요.");
    return { status: 200, skip: pick.bad };
  }
  const sb = svc(sk);
  const dup = await fetch(`${su}/rest/v1/sent_photos?select=id&tg_message_id=eq.${Number(pick.messageId)}&limit=1`, { headers: sb }).catch(() => null);
  if (!dup || !dup.ok) return { status: 200, skip: "table" }; // 표가 아직 없음(SQL 전) — 조용히 넘긴다
  if ((await dup.json().catch(() => [])).length) return { status: 200, skip: "dup" };
  // 여러 장 묶음은 첫 장에만 답한다(웹후크를 한 번에 하나씩 받게 연결해 둠).
  let firstOfGroup = true;
  if (pick.groupId) {
    const g = await fetch(`${su}/rest/v1/sent_photos?select=id&tg_group=eq.${encodeURIComponent(pick.groupId)}&limit=1`, { headers: sb }).catch(() => null);
    if (g && g.ok && (await g.json().catch(() => [])).length) firstOfGroup = false;
  }
  const dl = await tgDownload(token, pick.fileId);
  if (dl.err) { await say(dl.err === "not_jpeg" ? "이 사진은 받을 수 없어요. 사진으로 다시 보내 주세요." : FAIL); return { status: 200, skip: dl.err }; }
  const put = await putRaw(su, sk, dl.buf);
  if (put.err) { await say(FAIL); return { status: 200, skip: put.err }; }
  let info = {};
  if (pick.orderId) {
    const r = await fetch(`${su}/rest/v1/orders?order_id=eq.${encodeURIComponent(pick.orderId)}&select=order_id,order_type,product_code,product_label,address&limit=1`, { headers: sb }).catch(() => null);
    const o = r && r.ok ? ((await r.json().catch(() => [])) || [])[0] : null;
    if (o) info = { order_id: o.order_id, ...fromOrder(o) };
  }
  const row = {
    status: "pending", source: "telegram", raw_path: put.path, ...info,
    shot_on: kstDate(pick.date), note: pick.caption || null, tg_message_id: Number(pick.messageId), tg_group: pick.groupId || null,
  };
  const ins = await fetch(`${su}/rest/v1/sent_photos`, {
    method: "POST", headers: { ...sb, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(row),
  }).catch(() => null);
  if (!ins || !ins.ok) {
    await dropRaw(su, sk, put.path);
    if (ins && ins.status === 409) return { status: 200, skip: "dup" };
    await say(FAIL);
    return { status: 200, skip: "insert" };
  }
  if (firstOfGroup) {
    await say(`📷 사진 받았어요${info.title ? ` (${info.title})` : ""}. 관리 화면 '보낸 꽃 사진'에 넣어 뒀어요.`);
  }
  return { status: 200, saved: true, row };
}
