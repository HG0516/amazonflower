// api/parse-url.js
// 청첩장/부고 URL 또는 직접 입력 텍스트를 받아 Claude API로 파싱한다.
// 보안: ANTHROPIC_API_KEY는 이 서버 함수 안에서만 사용된다. 프론트에 절대 노출되지 않는다.

import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const config = {
  runtime: "nodejs",
};

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";

// 페이지 HTML에서 본문 텍스트만 대략 추출 (태그/스크립트 제거)
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchPageText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; AmazonFlowerBot/1.0; +https://amazonflower.example)",
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`페이지를 불러오지 못했습니다 (HTTP ${res.status})`);
  }
  const html = await res.text();
  const text = htmlToText(html);
  // 너무 길면 앞부분만 (토큰 절약)
  return text.slice(0, 8000);
}

const SYSTEM_PROMPT = `당신은 한국어 청첩장(결혼식) 또는 부고(장례식) 안내문에서 화환 배송에 필요한 정보를 추출하는 도우미입니다.
입력된 텍스트를 분석하여 아래 JSON 형식으로만 응답하세요. 설명, 마크다운, 코드블록 표시 없이 순수 JSON만 출력합니다.

{
  "type": "wedding" | "funeral" | "unknown",
  "recipientName": "수신인(신랑신부 또는 고인/상주) 이름. 모르면 빈 문자열",
  "date": "행사 날짜 (YYYY-MM-DD 형식, 모르면 빈 문자열)",
  "time": "행사 시간 (HH:MM 형식, 모르면 빈 문자열)",
  "venueName": "예식장/장례식장 이름. 모르면 빈 문자열",
  "venueAddress": "장소 주소. 모르면 빈 문자열",
  "venueDetail": "층/홀/호실 등 세부 위치 (예: 3층 그랜드홀, 특실 201호). 모르면 빈 문자열",
  "groomName": "신랑 이름 (결혼식인 경우만, 아니면 빈 문자열)",
  "brideName": "신부 이름 (결혼식인 경우만, 아니면 빈 문자열)",
  "chiefMourner": "상주 이름 (장례식인 경우만, 아니면 빈 문자열)",
  "confidence": "high" | "medium" | "low"
}

규칙:
- 결혼식 안내면 type을 "wedding", 장례/부고면 "funeral"로 설정.
- 날짜는 반드시 YYYY-MM-DD로 변환. 연도가 없으면 가장 가까운 미래 연도로 추정.
- 확실하지 않은 필드는 추측하지 말고 빈 문자열로 둔다.
- 정보가 거의 없으면 confidence를 "low"로.`;

function safeJsonParse(text) {
  // 혹시 코드블록이나 앞뒤 텍스트가 붙어와도 JSON 부분만 뽑아낸다
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw new Error("AI 응답을 해석하지 못했습니다.");
  }
}

export default async function handler(req, res) {
  // CORS (같은 도메인이면 불필요하지만 안전하게)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST 요청만 지원합니다." });
  }

  // ── 사업자등록 상태조회 (국세청 공공데이터 프록시) ──
  // body: {action:"bizcheck", bizNo:"000-00-00000"}
  // NTS_API_KEY(공공데이터포털 인증키, Decoding 값) 미설정·API 장애 시 {ok:true,skip:true} — 주문을 막지 않는다(fail-open)
  {
    let early = req.body;
    if (typeof early === "string") { try { early = JSON.parse(early || "{}"); } catch { early = {}; } }
    // ── 법인 상호 검색 (금융위 기업기본정보 프록시) ──
    // body: {action:"corpsearch", q:"회사명"} → {ok, items:[{name,bzno,addr}]}
    // 커버리지=법인(외감+비외감). 실패·미설정 시 빈 목록(fail-open) — 폼은 수기 입력 폴백 유지.
    if (early && early.action === "corpsearch") {
      const q = String(early.q || "").trim().slice(0, 40);
      if (q.length < 2) return res.status(200).json({ ok: true, items: [] });
      const ntsKey = process.env.NTS_API_KEY;
      if (!ntsKey) return res.status(200).json({ ok: true, items: [], skip: true });
      try {
        const enc = ntsKey.includes("%") ? ntsKey : encodeURIComponent(ntsKey);
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 4500);
        const r = await fetch(
          `https://apis.data.go.kr/1160100/service/GetCorpBasicInfoService_V2/getCorpOutline_V2?serviceKey=${enc}&pageNo=1&numOfRows=40&resultType=json&corpNm=${encodeURIComponent(q)}`,
          { signal: ctrl.signal }
        );
        clearTimeout(t);
        if (!r.ok) return res.status(200).json({ ok: true, items: [], skip: true });
        const j = await r.json();
        const raw = j?.response?.body?.items?.item || [];
        // 같은 회사가 출처별로 중복 수록됨 → bzno 기준 dedup(주소 있는 레코드 우선), 상위 6개만
        const byBzno = new Map();
        for (const it of (Array.isArray(raw) ? raw : [raw])) {
          if (!it || !/^\d{10}$/.test(String(it.bzno || ""))) continue;
          const cur = byBzno.get(it.bzno);
          if (!cur || (!cur.enpBsadr && it.enpBsadr)) byBzno.set(it.bzno, it);
          if (byBzno.size >= 24) break;
        }
        // 찾는 회사가 맨 위로: 검색어로 시작하는 이름 우선 → 이름 짧은 순(본사가 지점·판매점보다 짧다)
        const nq = q.replace(/\s+/g, "");
        const items = [...byBzno.values()]
          .map((it) => ({
            name: String(it.corpNm || "").replace(/\s+/g, " ").trim().slice(0, 60),
            bzno: String(it.bzno),
            addr: String(it.enpBsadr || "").replace(/\s+/g, " ").trim().slice(0, 80),
          }))
          .sort((a, b) => {
            const pa = a.name.replace(/\s+/g, "").startsWith(nq) ? 0 : 1;
            const pb = b.name.replace(/\s+/g, "").startsWith(nq) ? 0 : 1;
            return pa - pb || a.name.length - b.name.length;
          })
          .slice(0, 6);
        return res.status(200).json({ ok: true, items });
      } catch (e) {
        console.error("corpsearch error:", e && e.message);
        return res.status(200).json({ ok: true, items: [], skip: true });
      }
    }

    // ── 거래처 전용 링크 수신 (?corp=<사업자번호>&t=<토큰>) ──
    // body: {action:"corpinfo", regno, token} → {ok, corp:{name,regno,email,ceo,addr}}
    // 사장님이 그 거래처에만 준 링크의 서명 토큰이 맞을 때만 응답한다.
    // (토큰 없이 사업자번호만으로 열면 남의 거래처 담당자 이메일이 새므로 반드시 검증)
    if (early && early.action === "corpinfo") {
      const regno = String(early.regno || "").replace(/\D/g, "");
      if (!/^\d{10}$/.test(regno)) return res.status(400).json({ error: "사업자번호가 올바르지 않습니다." });
      const SECRET = process.env.CRON_SECRET || process.env.TOSS_SECRET_KEY || "";
      if (!SECRET) return res.status(503).json({ error: "설정이 필요합니다." });
      const expect = crypto.createHmac("sha256", SECRET).update("corp:" + regno).digest("hex").slice(0, 24);
      const got = String(early.token || "");
      const a = Buffer.from(got), b = Buffer.from(expect);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return res.status(401).json({ error: "링크가 유효하지 않습니다." });
      }
      const URL_ = process.env.SUPABASE_URL, KEY_ = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!URL_ || !KEY_) return res.status(503).json({ error: "설정이 필요합니다." });
      try {
        // 이 거래처의 가장 최근 주문에서 계산서 정보만 꺼낸다(받는분·보내는분 등 다른 주문정보는 절대 반환 안 함).
        const r = await fetch(
          `${URL_}/rest/v1/orders?corp_regno=eq.${regno}&select=corp_name,corp_regno,corp_email,corp_ceo,corp_addr&order=created_at.desc&limit=1`,
          { headers: { apikey: KEY_, Authorization: `Bearer ${KEY_}` } }
        );
        if (!r.ok) return res.status(502).json({ error: "거래처 정보를 불러오지 못했습니다." });
        const rows = await r.json().catch(() => []);
        if (!rows.length) return res.status(404).json({ error: "이 거래처의 지난 주문을 찾지 못했어요." });
        const c = rows[0];
        return res.status(200).json({
          ok: true,
          corp: {
            name: c.corp_name || "", regno: c.corp_regno || regno,
            email: c.corp_email || "", ceo: c.corp_ceo || "", addr: c.corp_addr || "",
          },
        });
      } catch (e) {
        console.error("corpinfo error:", e && e.message);
        return res.status(502).json({ error: "거래처 정보를 불러오지 못했습니다." });
      }
    }

    // ── 거래처 계정 대시보드: 주문내역 (corp.html) ──
    // 기존 corp 링크 토큰(corp:regno, tier-1)을 corpinfo 와 동일하게 검증. 안전 컬럼만(배송 PII 없음).
    if (early && early.action === "corporders") {
      const regno = String(early.regno || "").replace(/\D/g, "");
      if (!/^\d{10}$/.test(regno)) return res.status(400).json({ error: "사업자번호가 올바르지 않습니다." });
      const SECRET = process.env.CRON_SECRET || process.env.TOSS_SECRET_KEY || "";
      if (!SECRET) return res.status(503).json({ error: "설정이 필요합니다." });
      const expect = crypto.createHmac("sha256", SECRET).update("corp:" + regno).digest("hex").slice(0, 24);
      const got = String(early.token || "");
      const a = Buffer.from(got), b = Buffer.from(expect);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: "링크가 유효하지 않습니다." });
      const URL_ = process.env.SUPABASE_URL, KEY_ = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!URL_ || !KEY_) return res.status(503).json({ error: "설정이 필요합니다." });
      const hdr = { apikey: KEY_, Authorization: `Bearer ${KEY_}` };
      const base = "order_id,created_at,product_label,amount,status,order_type,event_date,sender_name";
      const qry = (cols) => `${URL_}/rest/v1/orders?corp_regno=eq.${regno}&select=${cols}&order=created_at.desc&limit=60`;
      try {
        // invoice_issued(계산서 발행상태) 포함 조회 → 컬럼 없으면 폴백(supabase-corp.sql 실행 전에도 안 깨짐).
        let r = await fetch(qry(base + ",invoice_issued"), { headers: hdr });
        if (!r.ok) r = await fetch(qry(base), { headers: hdr });
        if (!r.ok) return res.status(502).json({ error: "주문내역을 불러오지 못했습니다." });
        const rows = await r.json().catch(() => []);
        return res.status(200).json({ ok: true, orders: Array.isArray(rows) ? rows : [] });
      } catch (e) {
        console.error("corporders error:", e && e.message);
        return res.status(502).json({ error: "주문내역을 불러오지 못했습니다." });
      }
    }

    // ── 거래처: 세금계산서 재발행 요청 → 사장님 텔레그램 알림 (corp.html) ──
    // 같은 corp 토큰 검증 후, 전화 대신 사장님 단톡방에 요청을 남긴다. DB 변경 없음.
    if (early && early.action === "corpreq") {
      const regno = String(early.regno || "").replace(/\D/g, "");
      if (!/^\d{10}$/.test(regno)) return res.status(400).json({ error: "사업자번호가 올바르지 않습니다." });
      const SECRET = process.env.CRON_SECRET || process.env.TOSS_SECRET_KEY || "";
      if (!SECRET) return res.status(503).json({ error: "설정이 필요합니다." });
      const expect = crypto.createHmac("sha256", SECRET).update("corp:" + regno).digest("hex").slice(0, 24);
      const got = String(early.token || "");
      const a = Buffer.from(got), b = Buffer.from(expect);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: "링크가 유효하지 않습니다." });
      const memo = String(early.memo || "").replace(/\s+/g, " ").trim().slice(0, 200);
      const tg = process.env.TELEGRAM_BOT_TOKEN, tgc = process.env.TELEGRAM_CHAT_ID;
      if (tg && tgc) {
        const tag = process.env.PROJECT_TAG ? `[${process.env.PROJECT_TAG}] ` : "";
        try {
          await fetch(`https://api.telegram.org/bot${tg}/sendMessage`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: tgc, text: `${tag}🧾 세금계산서 재발행 요청\n사업자번호 ${regno}${memo ? `\n메모: ${memo}` : ""}\n(거래처 대시보드에서 요청)`, disable_web_page_preview: true }),
          });
        } catch { /* 알림 실패는 무시 */ }
      }
      return res.status(200).json({ ok: true });
    }

    // ── 거래처: 공급자 서류(사업자등록증) 다운로드 ──
    // 공개 정적파일이 아니라 corp 토큰이 확인된 요청에만 파일 바이트를 내려준다(거래처 전용).
    // 파일은 api/_corp 에 두고 함수 번들에 포함(vercel.json includeFiles). 공개 URL 아님.
    if (early && early.action === "corpdoc") {
      const regno = String(early.regno || "").replace(/\D/g, "");
      if (!/^\d{10}$/.test(regno)) return res.status(400).json({ error: "사업자번호가 올바르지 않습니다." });
      const SECRET = process.env.CRON_SECRET || process.env.TOSS_SECRET_KEY || "";
      if (!SECRET) return res.status(503).json({ error: "설정이 필요합니다." });
      const expect = crypto.createHmac("sha256", SECRET).update("corp:" + regno).digest("hex").slice(0, 24);
      const got = String(early.token || "");
      const a = Buffer.from(got), b = Buffer.from(expect);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: "링크가 유효하지 않습니다." });
      const FILES = { "biz-reg": "amazon-biz-reg.pdf" };
      const fname = FILES[String(early.doc || "biz-reg")];
      if (!fname) return res.status(404).json({ error: "없는 서류입니다." });
      try {
        const buf = readFileSync(fileURLToPath(new URL("./_corp/" + fname, import.meta.url)));
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", 'inline; filename="' + fname + '"');
        res.setHeader("Cache-Control", "private, no-store");
        return res.status(200).send(buf);
      } catch (e) {
        console.error("corpdoc read fail:", e && e.message);
        return res.status(502).json({ error: "서류를 불러오지 못했습니다." });
      }
    }

    if (early && early.action === "bizcheck") {
      const digits = String(early.bizNo || "").replace(/\D/g, "");
      if (!/^\d{10}$/.test(digits)) {
        return res.status(400).json({ error: "사업자등록번호 10자리가 필요합니다." });
      }
      const ntsKey = process.env.NTS_API_KEY;
      if (!ntsKey) return res.status(200).json({ ok: true, skip: true });
      try {
        const enc = ntsKey.includes("%") ? ntsKey : encodeURIComponent(ntsKey);
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 4000);
        const r = await fetch(
          `https://api.odcloud.kr/api/nts-businessman/v1/status?serviceKey=${enc}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ b_no: [digits] }),
            signal: ctrl.signal,
          }
        );
        clearTimeout(t);
        if (!r.ok) return res.status(200).json({ ok: true, skip: true });
        const j = await r.json();
        const d = (j.data && j.data[0]) || {};
        // b_stt_cd: 01 계속 / 02 휴업 / 03 폐업, 미등록이면 빈 값 + tax_type에 안내문
        const registered = !!d.b_stt_cd;
        return res.status(200).json({
          ok: true,
          registered,
          status: d.b_stt || (registered ? "" : "미등록"),
          statusCode: d.b_stt_cd || "",
          endDate: d.end_dt || "",
        });
      } catch (e) {
        console.error("bizcheck error:", e && e.message);
        return res.status(200).json({ ok: true, skip: true });
      }
    }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res
      .status(500)
      .json({ error: "서버에 ANTHROPIC_API_KEY가 설정되지 않았습니다." });
  }

  try {
    // Vercel은 보통 req.body를 자동 파싱하지만 안전하게 처리
    let body = req.body;
    if (typeof body === "string") {
      body = JSON.parse(body || "{}");
    }
    body = body || {};

    const { url, text } = body;

    let sourceText = "";
    if (url && typeof url === "string" && url.trim()) {
      // 기본 URL 형식 검증
      let parsed;
      try {
        parsed = new URL(url.trim());
      } catch {
        return res.status(400).json({ error: "올바른 URL 형식이 아닙니다." });
      }
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return res.status(400).json({ error: "http/https URL만 지원합니다." });
      }
      sourceText = await fetchPageText(parsed.toString());
    } else if (text && typeof text === "string" && text.trim()) {
      sourceText = text.trim().slice(0, 8000);
    } else {
      return res
        .status(400)
        .json({ error: "url 또는 text 중 하나는 반드시 입력해야 합니다." });
    }

    if (!sourceText) {
      return res
        .status(422)
        .json({ error: "페이지에서 분석할 텍스트를 찾지 못했습니다." });
    }

    const anthropicRes = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `다음 안내문에서 화환 배송 정보를 추출해 JSON으로만 응답하세요:\n\n${sourceText}`,
          },
        ],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error("Anthropic API error:", anthropicRes.status, errText);
      return res
        .status(502)
        .json({ error: "AI 분석 중 오류가 발생했습니다.", detail: anthropicRes.status });
    }

    const data = await anthropicRes.json();
    const aiText = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    const parsed = safeJsonParse(aiText);

    return res.status(200).json({ ok: true, result: parsed });
  } catch (err) {
    console.error("parse-url error:", err);
    return res
      .status(500)
      .json({ error: err.message || "알 수 없는 오류가 발생했습니다." });
  }
}
