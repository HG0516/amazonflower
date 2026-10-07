// 공개 경량 엔드포인트. 두 가지를 받는다:
//  1) 결제완료 화면 설문("어떻게 알고 오셨어요?") — order_id + referral_source (기존)
//  2) 웨딩(신부 부케) 예약 상담 문의 — type:"wedding" (신규). 사장님 텔레그램으로 전달.
// 새 API 함수 없이(12함수 제한) 이 공개 엔드포인트에 웨딩 문의를 얹었다.
export const config = { runtime: "nodejs" };

import { handleCardGet, handleCardPost } from "../lib/cards.mjs";
import { publicSetup } from "../lib/setup-status.mjs";
// 3) 무료 부고장·청첩장 정식판(10/6) — GET ?card=<id> (짧은 링크 /c/<id> 미리보기·내용), POST {type:"card"} (만들기·고치기·조문 글).

const ALLOWED = ["검색", "지인", "전단·현수막", "기타"];
const REGIONS = ["서울", "경기", "인천", "그 외"];
const NEEDS = ["본식 부케", "촬영용 부케", "부토니아·코사지", "신부 올인원", "프리저브드 보존"];

const cleanStr = (s, n) =>
  String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, n);

// 참고 사진 1장을 Supabase 스토리지(gallery 버킷, 공개)에 올리고 URL 반환. 실패하면 null.
async function uploadInqPhoto(dataUrl, URL, KEY) {
  if (typeof dataUrl !== "string" || !/^data:image\/(jpeg|jpg|png);base64,/.test(dataUrl)) return null;
  let buf;
  try { buf = Buffer.from(dataUrl.replace(/^data:image\/\w+;base64,/, ""), "base64"); } catch { return null; }
  if (!buf.length || buf.length > 3 * 1024 * 1024) return null; // 3MB 이하
  const isJpg = buf[0] === 0xFF && buf[1] === 0xD8;
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
  if (!isJpg && !isPng) return null; // 매직바이트
  const ext = isPng ? "png" : "jpg";
  const path = `wedding-inq/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  try {
    const up = await fetch(`${URL}/storage/v1/object/gallery/${encodeURI(path)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": isPng ? "image/png" : "image/jpeg", "x-upsert": "true" },
      body: buf,
    });
    if (!up.ok) { console.error("wed photo upload fail", up.status); return null; }
    return `${URL}/storage/v1/object/public/gallery/${encodeURI(path)}`;
  } catch (e) { console.error("wed photo upload err", e.message); return null; }
}

async function handleWedding(body, res) {
  const name = cleanStr(body.name, 30);
  const contact = cleanStr(body.contact, 40);
  const date = cleanStr(body.date, 20);
  const region = cleanStr(body.region, 10);
  const needs = Array.isArray(body.needs) ? body.needs.filter((n) => NEEDS.includes(n)).slice(0, 5) : [];
  const style = cleanStr(body.style, 500);
  if (!name || !contact || !date || !REGIONS.includes(region) || !needs.length) {
    return res.status(400).json({ error: "필수 항목을 확인해주세요." });
  }

  // 참고 사진(최대 3장) 업로드
  const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const photoUrls = [];
  const arr = Array.isArray(body.photos) ? body.photos.slice(0, 3) : [];
  if (URL && KEY) {
    for (const p of arr) {
      const u = await uploadInqPhoto(p, URL, KEY);
      if (u) photoUrls.push(u);
    }
  }

  // 사장님 텔레그램 알림 (주문 알림과 같은 방). 이게 유일한 전달 수단이라, 실패하면 손님에게 실패를 알린다.
  const tg = process.env.TELEGRAM_BOT_TOKEN, tgc = process.env.TELEGRAM_CHAT_ID;
  const tag = process.env.PROJECT_TAG ? `[${process.env.PROJECT_TAG}] ` : "";
  const lines = [
    `${tag}💐 웨딩(신부 부케) 예약 상담 신청`, "",
    `성함: ${name}`,
    `연락처: ${contact}`,
    `예식일: ${date}`,
    `지역: ${region}${region === "그 외" ? " ⚠️(수도권 외)" : ""}`,
    `필요: ${needs.join(", ")}`,
  ];
  if (style) lines.push(`구성/색감: ${style}`);
  if (photoUrls.length) { lines.push("", "참고 사진:"); photoUrls.forEach((u) => lines.push(u)); }

  if (!tg || !tgc) {
    console.error("wedding inquiry: telegram env missing");
    return res.status(503).json({ error: "예약 접수 설정이 아직이에요. 1577-2286 으로 전화 주세요." });
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${tg}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: tgc, text: lines.join("\n"), disable_web_page_preview: false }),
    });
    if (!r.ok) { console.error("wedding inquiry telegram fail", r.status, await r.text().catch(() => "")); throw new Error("send fail"); }
  } catch (e) {
    return res.status(502).json({ error: "접수 전송에 실패했어요. 잠시 후 다시 시도해주세요." });
  }
  return res.status(200).json({ ok: true });
}

// ── 캘린더 파일(.ics) 내려주기 ─────────────────────────────────
// iOS Safari 는 a[download] 를 지원하지 않아(WebKit #167341) 브라우저에서 Blob 으로 만든
// .ics 는 아이폰에서 조용히 실패한다. 제대로 된 Content-Type 을 붙여 서버가 내려주면
// 사파리가 캘린더 앱으로 넘겨준다. 새 함수를 만들 수 없으므로(12개 한도) 이 엔드포인트에 GET 으로 얹었다.
// 개인정보를 저장하지 않는다 — 쿼리로 받은 값을 그대로 파일로 만들어 돌려줄 뿐이다.
const icsEsc = (s) => String(s || "").replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
const p2 = (n) => String(n).padStart(2, "0");

function buildIcs(q) {
  const y = +q.y, m = +q.m, d = +q.d;
  if (!(y >= 2020 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const title = String(q.t || "일정").slice(0, 120);
  const desc = String(q.d2 || "").slice(0, 300);
  const yearly = q.r === "1";
  const hasTime = /^\d{1,2}:\d{2}$/.test(String(q.tm || ""));
  const [hh, mm] = hasTime ? String(q.tm).split(":").map(Number) : [0, 0];
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//꽃안부//KR", "CALSCALE:GREGORIAN", "BEGIN:VEVENT",
    `UID:kkotanbu-${y}${p2(m)}${p2(d)}-${Math.random().toString(36).slice(2, 8)}@floweranbu.co.kr`];
  if (hasTime) {
    L.push(`DTSTART:${y}${p2(m)}${p2(d)}T${p2(hh)}${p2(mm)}00`);
    L.push(`DTEND:${y}${p2(m)}${p2(d)}T${p2(Math.min(hh + 1, 23))}${p2(mm)}00`);
  } else {
    L.push(`DTSTART;VALUE=DATE:${y}${p2(m)}${p2(d)}`);
  }
  if (yearly) L.push("RRULE:FREQ=YEARLY;COUNT=5");
  L.push("SUMMARY:" + icsEsc(title));
  if (desc) L.push("DESCRIPTION:" + icsEsc(desc));
  L.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + icsEsc(title),
    "TRIGGER:" + (yearly ? "-P7D" : hasTime ? "-PT2H" : "-P1D"), "END:VALARM");
  L.push("END:VEVENT", "END:VCALENDAR");
  return L.join("\r\n");
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    let q = {};
    try { q = Object.fromEntries(new URL(req.url, "http://x").searchParams); } catch { q = {}; }
    // 4) 설정 확인(10/7) — 키를 넣고 다시 배포한 게 반영됐는지 밖에서 보는 용도. 값·보안 설정은 안 보냄.
    if (q.setup === "1") {
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json(publicSetup(process.env));
    }
    if (q.card) {
      const out = await handleCardGet(q, process.env, req.headers && req.headers["user-agent"]).catch((e) => { console.error("card get", e && e.message); return { status: 503, json: { error: "잠시 후 다시 시도해 주세요." } }; });
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
      if (out.html) { res.setHeader("Content-Type", "text/html; charset=utf-8"); return res.status(out.status).send(out.html); }
      return res.status(out.status).json(out.json);
    }
    if (q.ics !== "1") return res.status(405).json({ error: "POST only" });
    const body = buildIcs(q);
    if (!body) return res.status(400).json({ error: "날짜가 올바르지 않습니다." });
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="kkotanbu.ics"');
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(body);
  }
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  // ── 무료 부고장·청첩장 ──
  if (body.type === "card") {
    const out = await handleCardPost(body, req).catch((e) => { console.error("card post", e && e.message); return { status: 503, body: { error: "잠시 후 다시 시도해 주세요.", fallback: true } }; });
    res.setHeader("Cache-Control", "no-store");
    return res.status(out.status).json(out.body);
  }

  // ── 웨딩(신부 부케) 예약 상담 문의 ──
  if (body.type === "wedding") {
    try { return await handleWedding(body, res); }
    catch (e) { console.error("wedding inquiry err", e.message); return res.status(500).json({ error: "접수 중 오류가 발생했어요. 1577-2286 으로 전화 주세요." }); }
  }

  // ── 기존: 결제완료 설문 저장 ──
  const { order_id, referral_source } = body;
  // 주문번호 뒤는 지금 12자리(예전 6자리 검사 때문에 설문이 저장되지 않았다 — 10/6 점검).
  if (!/^AF[BC]?\d{8}-[A-Z0-9]{6,16}$/.test(String(order_id || ""))) {
    return res.status(400).json({ error: "잘못된 주문번호" });
  }
  if (!ALLOWED.includes(referral_source)) {
    return res.status(400).json({ error: "잘못된 값" });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(200).json({ saved: false });

  try {
    // referral_source 가 아직 비어있는(null) 주문에만 기록 — 덮어쓰기 불가
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/orders?order_id=eq.${encodeURIComponent(order_id)}&referral_source=is.null`,
      {
        method: "PATCH",
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ referral_source }),
      }
    );
    return res.status(200).json({ saved: r.ok });
  } catch (e) {
    return res.status(200).json({ saved: false });
  }
}
