// 무료 부고장·청첩장 정식판(2026-10-06) — 서버 쪽.
//
// 왜: 초안은 내용을 링크 # 뒤에 통째로 담아서 링크가 길고(500자+), 카톡에 붙이면 미리보기가
// '꽃안부' 한 장뿐이고, 보낸 뒤엔 고칠 수 없고, 조문 글도 받을 수 없었다.
// 무엇: cards(내용) · card_comments(조문 글·방명록) 두 표(supabase-cards.sql, service_role 전용).
//  - 짧은 링크 /c/<id> → api/order-meta?card=<id> 가 카드마다 다른 미리보기(OG)를 내주고 card.html?c=<id> 로 보낸다.
//  - 고치기·닫기·글 숨기기는 만들 때 받은 '수정 키'로만(서버엔 해시만 저장).
//  - 기간이 지나면(부고 발인+7일, 청첩장 예식+30일) 내용·글을 지운다(check-deadlines 30분 크론 + 열람 때).
// 새 API 함수는 만들 수 없어서(12개 한도) 공개 경량 엔드포인트 api/order-meta.js 에 얹는다.
// 표가 아직 없으면(SQL 적용 전) 503 + fallback:true → 만들기 화면은 예전처럼 긴 링크로 만든다.

import crypto from "node:crypto";
import { kakaoShareKey } from "./setup-status.mjs";

export const CARD_ID_RE = /^[A-Za-z0-9]{6,12}$/;
const B62 = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"; // 헷갈리는 글자(0O1lI) 뺌
const MAX_DATA_BYTES = 8000;
const BASE = () => (process.env.PUBLIC_BASE_URL || "https://floweranbu.co.kr").replace(/\/+$/, "");

export function newCardId(n = 7) {
  const bytes = crypto.randomBytes(n);
  let s = "";
  for (const b of bytes) s += B62[b % B62.length];
  return s;
}
export const newEditKey = () => crypto.randomBytes(18).toString("base64url");
export const editHash = (key) => crypto.createHash("sha256").update(`card-edit:${String(key || "")}`).digest("hex");

const S = (v, n) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const ML = (v, n) => String(v == null ? "" : v).replace(/\r/g, "").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").trim().slice(0, n); // 줄바꿈 허용
const DATE = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : "");
const TIME = (v) => (/^\d{2}:\d{2}$/.test(String(v || "")) ? String(v) : "");
const ARR = (v, max, f) => (Array.isArray(v) ? v.slice(0, max).map((x) => f(x || {})) : []);

/** 만들기 화면이 보낸 내용을 정리한다. 모르는 칸은 버린다. */
export function sanitizeCard(raw) {
  if (!raw || typeof raw !== "object") return { ok: false, error: "내용이 비어 있어요." };
  let d;
  if (raw.k === "f") {
    d = {
      k: "f",
      theme: ["mono", "gukhwa"].includes(raw.theme) ? raw.theme : "mono",
      name: S(raw.name, 30), age: S(raw.age, 4).replace(/[^0-9]/g, ""), died: DATE(raw.died),
      rel: ["", "기독교", "천주교", "불교"].includes(raw.rel) ? raw.rel : "",
      m: ARR(raw.m, 15, (x) => ({ r: S(x.r, 10), n: S(x.n, 30) })).filter((x) => x.n),
      venue: S(raw.venue, 60), room: S(raw.room, 30), tel: S(raw.tel, 20), addr: S(raw.addr, 140),
      burial: S(raw.burial, 60), outDate: DATE(raw.outDate), out: TIME(raw.out),
    };
    if (!d.name || !d.venue) return { ok: false, error: "고인 성함과 장례식장을 적어 주세요." };
  } else if (raw.k === "w") {
    d = {
      k: "w",
      theme: ["classic", "flower"].includes(raw.theme) ? raw.theme : "classic",
      g: S(raw.g, 20), b: S(raw.b, 20), gp: S(raw.gp, 40), bp: S(raw.bp, 40),
      date: DATE(raw.date), time: TIME(raw.time),
      venue: S(raw.venue, 60), hall: S(raw.hall, 40), addr: S(raw.addr, 140), park: S(raw.park, 120),
      photo: /^https:\/\/[^\s"'<>]{8,500}$/.test(String(raw.photo || "")) ? String(raw.photo) : "",
    };
    if (!d.g || !d.b || !d.date || !d.venue) return { ok: false, error: "신랑·신부, 날짜, 예식장을 적어 주세요." };
  } else {
    return { ok: false, error: "부고장인지 청첩장인지 알 수 없어요." };
  }
  const msg = ML(raw.msg, 400);
  if (msg) d.msg = msg;
  const acc = ARR(raw.acc, 10, (a) => ({ who: S(a.who, 30), bank: S(a.bank, 20), no: S(a.no, 30) })).filter((a) => a.no);
  if (acc.length) d.acc = acc;
  if (raw.noWreath) d.noWreath = 1;
  if (raw.noComment) d.noComment = 1;
  if (raw.noRsvp && d.k === "w") d.noRsvp = 1;      // 청첩장 참석 여부 안 받기
  const ref = String(raw.ref == null ? "" : raw.ref).trim();   // 파트너 코드(상조·식장) — 어디서 만들어졌는지 세는 용도, 화면엔 안 나온다. 형식이 틀리면 자르지 않고 버린다
  if (/^[A-Za-z0-9_-]{1,30}$/.test(ref)) d.ref = ref;
  if (Buffer.byteLength(JSON.stringify(d), "utf8") > MAX_DATA_BYTES) return { ok: false, error: "내용이 너무 길어요." };
  return { ok: true, data: d };
}

/** 자동으로 닫히는 때 — 부고: 발인(없으면 별세일·오늘)+7일, 청첩장: 예식+30일. 한국시간 그날 밤 11:59. */
export function cardExpiry(d, now = Date.now()) {
  const kstToday = new Date(now + 9 * 3600000).toISOString().slice(0, 10);
  const base = d.k === "f" ? (d.outDate || d.died || kstToday) : (d.date || kstToday);
  const days = d.k === "f" ? 7 : 30;
  const [y, m, dd] = base.split("-").map(Number);
  let t = Date.UTC(y, m - 1, dd + days, 23 - 9, 59, 59);
  t = Math.max(t, now + 24 * 3600000);          // 지난 날짜로 만들어도 최소 하루는 열린다
  t = Math.min(t, now + 400 * 24 * 3600000);    // 너무 먼 날짜 방지
  return new Date(t).toISOString();
}

const WD = ["일", "월", "화", "수", "목", "금", "토"];
function kDate(s) { const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})$/); if (!m) return ""; const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return `${+m[2]}월 ${+m[3]}일(${WD[dt.getUTCDay()]})`; }
function kTime(hm) { const m = String(hm || "").match(/^(\d{2}):(\d{2})$/); if (!m) return ""; const h = +m[1], mi = +m[2]; return `${h < 12 ? "오전" : "오후"} ${(h % 12) || 12}시${mi ? ` ${mi}분` : ""}`; }
const WORD = { "기독교": "소천", "천주교": "선종", "불교": "입적" };

export function cardTitle(d) {
  return d.k === "f" ? `[부고] 故 ${d.name} 님 ${WORD[d.rel] || "별세"}` : `${d.g} ♥ ${d.b} 결혼합니다`;
}
export function cardDesc(d) {
  if (d.k === "f") return [[d.venue, d.room].filter(Boolean).join(" "), d.out ? `발인 ${kDate(d.outDate)} ${kTime(d.out)}`.trim() : ""].filter(Boolean).join(" · ");
  return [`${kDate(d.date)} ${kTime(d.time)}`.trim(), [d.venue, d.hall].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
}
export function cardImage(d) {
  const t = d ? (d.k === "f" ? (d.theme === "gukhwa" ? "f-gukhwa" : "f-mono") : (d.theme === "flower" ? "w-flower" : "w-classic")) : "f-mono";
  return `${BASE()}/og/card-${t}.png`;
}

const H = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// 링크 미리보기를 만드는 봇(카톡 kakaotalk-scrap, 페북, 네이버 Yeti …). 이들한텐 바로 넘기는 코드를 빼서
// 넘어간 곳(card.html, 공통 미리보기)의 제목·사진을 잘못 가져가지 않게 한다. 카톡 인앱 브라우저(KAKAOTALK)는 사람이다.
export const isPreviewBot = (ua) => /scrap|bot\b|bot\/|crawl|spider|facebookexternalhit|Yeti|preview|WhatsApp|TelegramBot|Slackbot|Discordbot|Twitterbot/i.test(String(ua || ""));

/** 카톡·문자 미리보기용 HTML. 사람은 바로 card.html?c=<id> 로 넘어간다(봇은 그대로 머문다). */
export function renderOgHtml({ id, data, closed, go, bot }) {
  const base = BASE();
  const url = `${base}/c/${id}`;
  const dest = go === "map" && data
    ? `https://map.kakao.com/link/search/${encodeURIComponent(data.venue || data.addr || "")}`
    : `${base}/card.html?c=${encodeURIComponent(id)}`;
  const title = closed || !data ? "닫힌 안내예요 — 꽃안부" : cardTitle(data);
  const desc = closed || !data ? "기간이 지났거나 만든 분이 닫았어요." : (cardDesc(data) || "눌러서 자세히 보기");
  const img = cardImage(data);
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${H(title)}</title><meta name="robots" content="noindex">
<meta property="og:type" content="website"><meta property="og:url" content="${H(url)}"><meta property="og:title" content="${H(title)}">
<meta property="og:description" content="${H(desc)}"><meta property="og:image" content="${H(img)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">${bot ? "" : `<meta http-equiv="refresh" content="0; url=${H(dest)}">
<script>location.replace(${JSON.stringify(dest).replace(/</g, "\\u003c")});</script>`}</head>
<body style="font-family:sans-serif;text-align:center;padding:40px;"><p>${H(title)}</p><p><a href="${H(dest)}">열기 →</a></p></body></html>`;
}

// 사장님 텔레그램 한 줄(새 부고장·청첩장). 토큰 없으면 조용히 건너뛴다. 이름은 넣지 않는다(식장·일정·링크만).
async function tgNotify(env, text) {
  const tg = env.TELEGRAM_BOT_TOKEN, chat = env.TELEGRAM_CHAT_ID;
  if (!tg || !chat) return false;
  const r = await sbFetch(`https://api.telegram.org/bot${tg}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
  }, 4000);
  return r.ok;
}
export function createdText(d, url) {
  if (d.k === "f") {
    return ["🕊 새 부고장이 만들어졌어요", [d.venue, d.room].filter(Boolean).join(" ") || "장례식장 미정",
      d.out ? `발인 ${kDate(d.outDate)} ${kTime(d.out)}`.trim() : "발인 미정", d.ref ? `파트너 코드 ${d.ref}` : "", url].filter(Boolean).join("\n");
  }
  return ["💍 새 청첩장이 만들어졌어요", [d.venue, d.hall].filter(Boolean).join(" ") || "예식장 미정",
    `${kDate(d.date)} ${kTime(d.time)}`.trim(), d.ref ? `파트너 코드 ${d.ref}` : "", url].filter(Boolean).join("\n");
}

// ── Supabase ──
function sbEnv(env) {
  const url = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url, headers: (extra = {}) => ({ apikey: key, Authorization: `Bearer ${key}`, ...extra }) };
}
async function sbFetch(url, opts = {}, timeoutMs = 5000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ac.signal });
    const text = await r.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    return { ok: r.ok, status: r.status, data, text };
  } catch (e) {
    return { ok: false, status: 0, data: null, text: String(e && e.message || e) };
  } finally { clearTimeout(t); }
}
const tableMissing = (r) => (r.status === 404 || r.status === 400) && /PGRST205|42P01|card(_comments|s)\b.*(does not exist|schema cache|Could not find)/i.test(r.text || "");
const FALLBACK = { status: 503, body: { error: "정식 링크 준비 중이에요.", fallback: true } };

function ipHash(req, env) {
  const h = (req && req.headers) || {};
  const ip = String(h["x-vercel-forwarded-for"] || h["x-forwarded-for"] || h["x-real-ip"] || "unknown").split(",")[0].trim().slice(0, 64);
  const day = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const secret = env.CRON_SECRET || env.TOSS_SECRET_KEY || "kkotanbu-card";
  return crypto.createHmac("sha256", secret).update(`card:${ip}:${day}`).digest("hex").slice(0, 32);
}

async function loadCard(sb, id) {
  const r = await sbFetch(`${sb.url}/rest/v1/cards?id=eq.${encodeURIComponent(id)}&select=id,kind,data,edit_hash,views,expires_at,closed_at&limit=1`, { headers: sb.headers() });
  if (tableMissing(r)) return { missing: true };
  if (!r.ok || !Array.isArray(r.data)) return { error: true };
  return { row: r.data[0] || null };
}
const isOpen = (row, now = Date.now()) => !!(row && row.data && !row.closed_at && Date.parse(row.expires_at) > now);
const keyOk = (row, key) => {
  if (!row || !key) return false;
  const a = Buffer.from(editHash(key)), b = Buffer.from(String(row.edit_hash || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

async function closeCard(sb, id) {
  await sbFetch(`${sb.url}/rest/v1/cards?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH", headers: sb.headers({ "Content-Type": "application/json", Prefer: "return=minimal" }),
    body: JSON.stringify({ data: null, closed_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
  });
  await sbFetch(`${sb.url}/rest/v1/card_comments?card_id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: sb.headers({ Prefer: "return=minimal" }) });
  await sbFetch(`${sb.url}/rest/v1/card_rsvps?card_id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: sb.headers({ Prefer: "return=minimal" }) });
}

// 참석 여부 표(supabase-card-rsvps.sql)가 있는지 — 없으면 화면에서 그 칸을 뺀다. 1분 기억.
let RSVP_CACHE = { at: 0, val: false };
async function rsvpReady(sb) {
  if (Date.now() - RSVP_CACHE.at < 60000) return RSVP_CACHE.val;
  const r = await sbFetch(`${sb.url}/rest/v1/card_rsvps?select=id&limit=1`, { headers: sb.headers() }, 3000);
  RSVP_CACHE = { at: Date.now(), val: r.ok && !tableMissing(r) };
  return RSVP_CACHE.val;
}
async function listRsvps(sb, id) {
  const r = await sbFetch(`${sb.url}/rest/v1/card_rsvps?card_id=eq.${encodeURIComponent(id)}&select=id,name,attend,headcount,side,memo,created_at&order=created_at.desc&limit=500`, { headers: sb.headers() });
  return Array.isArray(r.data) ? r.data : [];
}

async function listComments(sb, id, includeHidden = false) {
  const r = await sbFetch(`${sb.url}/rest/v1/card_comments?card_id=eq.${encodeURIComponent(id)}${includeHidden ? "" : "&hidden=eq.false"}&select=id,name,body,hidden,created_at&order=created_at.desc&limit=200`, { headers: sb.headers() });
  return Array.isArray(r.data) ? r.data : [];
}

// 사진 올리기 도배 막기 — 한 곳에서 한 시간 20장(함수 인스턴스마다 따로 세지만 충분하다)
const PHOTO_SEEN = new Map();
function photoAllowed(key) {
  const now = Date.now();
  const list = (PHOTO_SEEN.get(key) || []).filter((t) => now - t < 3600000);
  if (list.length >= 20) { PHOTO_SEEN.set(key, list); return false; }
  list.push(now); PHOTO_SEEN.set(key, list);
  return true;
}

/** POST {type:"card", action:...} */
export async function handleCardPost(body, req, env = process.env) {
  const sb = sbEnv(env);
  if (!sb) return FALLBACK;
  const action = String(body.action || "");
  const id = String(body.id || "");

  if (action === "photo") {
    // 청첩장 대표 사진 — 공개 버킷(gallery) cards/ 에 올리고 주소만 돌려준다. jpg·png, 3MB.
    const dataUrl = String(body.image || "");
    if (!/^data:image\/(jpeg|jpg|png);base64,/.test(dataUrl)) return { status: 400, body: { error: "jpg·png 사진만 올릴 수 있어요." } };
    let buf;
    try { buf = Buffer.from(dataUrl.replace(/^data:image\/\w+;base64,/, ""), "base64"); } catch { return { status: 400, body: { error: "사진을 읽지 못했어요." } }; }
    if (!buf.length || buf.length > 3 * 1024 * 1024) return { status: 413, body: { error: "사진이 너무 커요(3MB까지)." } };
    const isJpg = buf[0] === 0xff && buf[1] === 0xd8;
    const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    if (!isJpg && !isPng) return { status: 400, body: { error: "jpg·png 사진만 올릴 수 있어요." } };
    if (!photoAllowed(ipHash(req, env))) return { status: 429, body: { error: "잠시 후 다시 올려 주세요." } };
    const path = `cards/${newCardId(10)}.${isPng ? "png" : "jpg"}`;
    const up = await sbFetch(`${sb.url}/storage/v1/object/gallery/${path}`, {
      method: "POST", headers: sb.headers({ "Content-Type": isPng ? "image/png" : "image/jpeg", "x-upsert": "true" }), body: buf,
    }, 15000);
    if (!up.ok) return { status: 503, body: { error: "사진을 올리지 못했어요. 잠시 후 다시 시도해 주세요." } };
    return { status: 200, body: { ok: true, url: `${sb.url}/storage/v1/object/public/gallery/${path}` } };
  }

  if (action === "create") {
    const clean = sanitizeCard(body.data);
    if (!clean.ok) return { status: 400, body: { error: clean.error } };
    const ih = ipHash(req, env);
    const hourAgo = new Date(Date.now() - 3600000).toISOString();
    const mine = await sbFetch(`${sb.url}/rest/v1/cards?ip_hash=eq.${ih}&created_at=gte.${encodeURIComponent(hourAgo)}&select=id&limit=13`, { headers: sb.headers() });
    if (tableMissing(mine)) return FALLBACK;
    if (Array.isArray(mine.data) && mine.data.length >= 12) return { status: 429, body: { error: "잠시 후 다시 만들어 주세요." } };
    const key = newEditKey();
    const expires = cardExpiry(clean.data);
    for (let i = 0; i < 4; i++) {
      const cid = newCardId();
      const r = await sbFetch(`${sb.url}/rest/v1/cards`, {
        method: "POST", headers: sb.headers({ "Content-Type": "application/json", Prefer: "return=minimal" }),
        body: JSON.stringify({ id: cid, kind: clean.data.k, data: clean.data, edit_hash: editHash(key), expires_at: expires, ip_hash: ih }),
      });
      if (r.ok) {
        const url = `${BASE()}/c/${cid}`;
        await tgNotify(env, createdText(clean.data, url)).catch(() => {});
        return { status: 200, body: { ok: true, id: cid, key, url, expiresAt: expires } };
      }
      if (tableMissing(r)) return FALLBACK;
      if (r.status !== 409) return { status: 503, body: { error: "저장하지 못했어요. 잠시 후 다시 시도해 주세요.", fallback: true } };
    }
    return { status: 503, body: { error: "잠시 후 다시 시도해 주세요.", fallback: true } };
  }

  if (!CARD_ID_RE.test(id)) return { status: 400, body: { error: "잘못된 링크예요." } };
  const loaded = await loadCard(sb, id);
  if (loaded.missing) return FALLBACK;
  if (loaded.error) return { status: 503, body: { error: "잠시 후 다시 시도해 주세요." } };
  const row = loaded.row;
  if (!row) return { status: 404, body: { error: "없는 링크예요." } };

  if (action === "comment") {
    if (!isOpen(row)) return { status: 410, body: { error: "닫힌 안내예요." } };
    if (row.data.noComment) return { status: 403, body: { error: "글을 받지 않는 안내예요." } };
    const name = S(body.name, 20), text = ML(body.body, 300);
    if (!name || !text) return { status: 400, body: { error: "이름과 글을 적어 주세요." } };
    if (/https?:\/\/|www\.|\.(com|net|kr|co)\b/i.test(name + " " + text)) return { status: 400, body: { error: "링크는 남길 수 없어요." } };
    const ih = ipHash(req, env);
    const since = new Date(Date.now() - 10 * 60000).toISOString();
    const recent = await sbFetch(`${sb.url}/rest/v1/card_comments?card_id=eq.${encodeURIComponent(id)}&ip_hash=eq.${ih}&created_at=gte.${encodeURIComponent(since)}&select=id`, { headers: sb.headers() });
    if (Array.isArray(recent.data) && recent.data.length >= 5) return { status: 429, body: { error: "잠시 후 다시 남겨 주세요." } };
    const r = await sbFetch(`${sb.url}/rest/v1/card_comments`, {
      method: "POST", headers: sb.headers({ "Content-Type": "application/json", Prefer: "return=representation" }),
      body: JSON.stringify({ card_id: id, name, body: text, ip_hash: ih }),
    });
    if (!r.ok) return { status: 503, body: { error: "남기지 못했어요. 잠시 후 다시 시도해 주세요." } };
    const c = Array.isArray(r.data) ? r.data[0] : null;
    return { status: 200, body: { ok: true, comment: c ? { id: c.id, name: c.name, body: c.body, created_at: c.created_at } : null } };
  }

  if (action === "rsvp") {
    // 청첩장 참석 여부 — 참석해요(인원)·못 가요. 못 가요 뒤엔 화면이 '꽃으로 마음 전하기'를 보여 준다.
    if (!isOpen(row)) return { status: 410, body: { error: "닫힌 안내예요." } };
    if (row.kind !== "w" || row.data.noRsvp) return { status: 403, body: { error: "참석 여부를 받지 않는 안내예요." } };
    const name = S(body.name, 20), memo = ML(body.memo, 100);
    const attend = body.attend === true || body.attend === "1" || body.attend === "yes";
    const side = ["groom", "bride"].includes(body.side) ? body.side : "";
    let headcount = attend ? parseInt(body.headcount, 10) : 1;
    if (!Number.isInteger(headcount) || headcount < 1 || headcount > 10) headcount = 1;
    if (!name) return { status: 400, body: { error: "이름을 적어 주세요." } };
    if (/https?:\/\/|www\.|\.(com|net|kr|co)\b/i.test(name + " " + memo)) return { status: 400, body: { error: "링크는 남길 수 없어요." } };
    const ih = ipHash(req, env);
    const since = new Date(Date.now() - 10 * 60000).toISOString();
    const recent = await sbFetch(`${sb.url}/rest/v1/card_rsvps?card_id=eq.${encodeURIComponent(id)}&ip_hash=eq.${ih}&created_at=gte.${encodeURIComponent(since)}&select=id`, { headers: sb.headers() });
    if (tableMissing(recent)) return FALLBACK;
    if (Array.isArray(recent.data) && recent.data.length >= 5) return { status: 429, body: { error: "잠시 후 다시 보내 주세요." } };
    const r = await sbFetch(`${sb.url}/rest/v1/card_rsvps`, {
      method: "POST", headers: sb.headers({ "Content-Type": "application/json", Prefer: "return=minimal" }),
      body: JSON.stringify({ card_id: id, name, attend, headcount, side, memo, ip_hash: ih }),
    });
    if (tableMissing(r)) return FALLBACK;
    if (!r.ok) return { status: 503, body: { error: "보내지 못했어요. 잠시 후 다시 시도해 주세요." } };
    return { status: 200, body: { ok: true, attend } };
  }

  // 여기부터는 수정 키가 있어야 한다
  if (!keyOk(row, body.key)) return { status: 403, body: { error: "수정 링크가 맞지 않아요." } };

  if (action === "manage") {
    if (!row.data) return { status: 410, body: { error: "닫힌 안내예요." } };
    const rsvpOn = row.kind === "w" && await rsvpReady(sb);
    return { status: 200, body: { ok: true, data: row.data, views: row.views, expiresAt: row.expires_at, comments: await listComments(sb, id, true), rsvps: rsvpOn ? await listRsvps(sb, id) : [], rsvpReady: rsvpOn, url: `${BASE()}/c/${id}` } };
  }
  if (action === "update") {
    if (!isOpen(row)) return { status: 410, body: { error: "닫힌 안내예요." } };
    const clean = sanitizeCard(body.data);
    if (!clean.ok) return { status: 400, body: { error: clean.error } };
    if (clean.data.k !== row.kind) return { status: 400, body: { error: "부고장·청첩장 종류는 바꿀 수 없어요." } };
    const r = await sbFetch(`${sb.url}/rest/v1/cards?id=eq.${encodeURIComponent(id)}&edit_hash=eq.${row.edit_hash}`, {
      method: "PATCH", headers: sb.headers({ "Content-Type": "application/json", Prefer: "return=minimal" }),
      body: JSON.stringify({ data: clean.data, expires_at: cardExpiry(clean.data), updated_at: new Date().toISOString() }),
    });
    if (!r.ok) return { status: 503, body: { error: "고치지 못했어요. 잠시 후 다시 시도해 주세요." } };
    return { status: 200, body: { ok: true, url: `${BASE()}/c/${id}` } };
  }
  if (action === "hide") {
    const cid = Number(body.commentId);
    if (!Number.isInteger(cid) || cid <= 0) return { status: 400, body: { error: "잘못된 글이에요." } };
    const r = await sbFetch(`${sb.url}/rest/v1/card_comments?id=eq.${cid}&card_id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH", headers: sb.headers({ "Content-Type": "application/json", Prefer: "return=minimal" }),
      body: JSON.stringify({ hidden: body.hidden !== false }),
    });
    return r.ok ? { status: 200, body: { ok: true } } : { status: 503, body: { error: "잠시 후 다시 시도해 주세요." } };
  }
  if (action === "close") {
    await closeCard(sb, id);
    return { status: 200, body: { ok: true } };
  }
  return { status: 400, body: { error: "알 수 없는 요청이에요." } };
}

/** 만들기 화면이 처음 열릴 때: 정식판(표)이 준비됐는지 + 카카오 공유 키(공개용 JavaScript 키, Vercel env). */
const kakaoKeyOf = (env) => kakaoShareKey(env);
async function cardReady(env) {
  const kakaoKey = kakaoKeyOf(env);
  const sb = sbEnv(env);
  if (!sb) return { status: 200, json: { ready: false, kakaoKey } };
  const r = await sbFetch(`${sb.url}/rest/v1/cards?select=id&limit=1`, { headers: sb.headers() }, 3000);
  const ready = r.ok && !tableMissing(r);
  return { status: 200, json: { ready, kakaoKey, rsvp: ready ? await rsvpReady(sb) : false } };
}

/** GET ?card=<id>[&json=1][&go=map] · ?card=ready&json=1 */
export async function handleCardGet(q, env = process.env, ua = "") {
  const id = String(q.card || "");
  const json = q.json === "1";
  if (id === "ready" && json) return cardReady(env);
  const bot = isPreviewBot(ua);
  if (!CARD_ID_RE.test(id)) return json ? { status: 400, json: { error: "잘못된 링크예요." } } : { status: 404, html: renderOgHtml({ id: "x", data: null, closed: true }) };
  const sb = sbEnv(env);
  if (!sb) return json ? { status: 503, json: { error: "잠시 후 다시 시도해 주세요." } } : { status: 503, html: renderOgHtml({ id, data: null, closed: true }) };
  const loaded = await loadCard(sb, id);
  if (loaded.missing || loaded.error) return json ? { status: 503, json: { error: "잠시 후 다시 시도해 주세요." } } : { status: 200, html: renderOgHtml({ id, data: null, closed: true }) };
  const row = loaded.row;
  if (!row) return json ? { status: 404, json: { error: "없는 링크예요." } } : { status: 404, html: renderOgHtml({ id, data: null, closed: true }) };
  const open = isOpen(row);
  if (!open && row.data) await closeCard(sb, id).catch(() => {});   // 기간 지난 걸 처음 연 순간 지운다
  if (!json) return { status: open ? 200 : 410, html: renderOgHtml({ id, data: open ? row.data : null, closed: !open, go: q.go, bot }) };
  if (!open) return { status: 410, json: { closed: true, kind: row.kind } };
  sbFetch(`${sb.url}/rest/v1/rpc/card_touch`, { method: "POST", headers: sb.headers({ "Content-Type": "application/json" }), body: JSON.stringify({ p_id: id }) }, 1500).catch(() => {});
  const comments = row.data.noComment ? [] : await listComments(sb, id, false);
  const rsvp = row.kind === "w" && !row.data.noRsvp ? await rsvpReady(sb) : false;
  return { status: 200, json: { ok: true, data: row.data, comments, expiresAt: row.expires_at, kakaoKey: kakaoKeyOf(env), rsvp } };
}

/** 30분 크론: 기간 지난 카드의 내용·글 지우기(한 번에 최대 100개). */
export async function cleanupExpiredCards(env = process.env) {
  const sb = sbEnv(env);
  if (!sb) return { skipped: true };
  const now = new Date().toISOString();
  const r = await sbFetch(`${sb.url}/rest/v1/cards?expires_at=lt.${encodeURIComponent(now)}&closed_at=is.null&select=id&limit=100`, { headers: sb.headers() });
  if (tableMissing(r)) return { skipped: "no_table" };
  if (!Array.isArray(r.data)) return { error: true };
  let closed = 0;
  for (const row of r.data) { await closeCard(sb, row.id); closed++; }
  return { closed };
}
