// api/parse-url.js
// 청첩장/부고 URL 또는 직접 입력 텍스트를 받아 Claude API로 파싱한다.
// 보안: ANTHROPIC_API_KEY는 이 서버 함수 안에서만 사용된다. 프론트에 절대 노출되지 않는다.

import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { askClaude, extractJson, AI_MODEL } from "../lib/ai.mjs";
import { createRequire } from "node:module";
import { fixParsed, kstToday, pageToText } from "../lib/parse-fix.mjs";

// 장례식장 목록(공공데이터 1,117곳, 부고장 만들기와 같은 목록) — 자동읽기 결과의 장례식장 주소를 맞춰 본다.
let HOMES = null;
function funeralHomes() {
  if (HOMES) return HOMES;
  try { HOMES = createRequire(import.meta.url)("../data/funeral-homes.json").items || []; } catch { HOMES = []; }
  return HOMES;
}
const THIN_MSG = "이 링크는 열어도 내용이 바로 보이지 않는 곳이에요. 화면을 캡처해 사진으로 올리시거나, 받으신 문자를 통째로 붙여넣어 주세요.";

export const config = {
  runtime: "nodejs",
};

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = AI_MODEL;

async function fetchPageText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; AmazonFlowerBot/1.0; +https://amazonflower.example)",
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) {
    throw new Error(`페이지를 불러오지 못했습니다 (HTTP ${res.status})`);
  }
  const html = await res.text();
  // 미리보기 요약·본문·페이지 안 데이터를 같이 읽는다(lib/parse-fix.mjs pageToText). 너무 길면 앞부분만(토큰 절약).
  const { text, hangul } = pageToText(html);
  return { text: text.slice(0, 10000), hangul };
}

const SYSTEM_PROMPT = `당신은 한국어 청첩장(결혼식) 또는 부고(장례식) 안내문에서 화환 배송에 필요한 정보를 추출하는 도우미입니다.
입력된 텍스트를 분석하여 아래 JSON 형식으로만 응답하세요. 설명, 마크다운, 코드블록 표시 없이 순수 JSON만 출력합니다.

{
  "type": "wedding" | "funeral" | "unknown",
  "recipientName": "결혼식은 신랑·신부 이름, 장례식은 고인 성함만(故 없이), 그 밖은 받는 분. 장례식에서 상주 이름을 여기에 넣지 않는다. 모르면 빈 문자열",
  "date": "결혼식은 예식 날짜, 장례식은 발인 날짜 (YYYY-MM-DD 형식, 모르면 빈 문자열)",
  "time": "결혼식은 예식 시간, 장례식은 발인 시간 (HH:MM 형식, 모르면 빈 문자열)",
  "venueName": "예식장/장례식장 이름. 모르면 빈 문자열",
  "venueAddress": "장소 주소. 모르면 빈 문자열",
  "venueDetail": "층/홀/호실 등 세부 위치 (예: 3층 그랜드홀, 특실 201호). 모르면 빈 문자열",
  "groomName": "신랑 이름 (결혼식인 경우만, 아니면 빈 문자열)",
  "brideName": "신부 이름 (결혼식인 경우만, 아니면 빈 문자열)",
  "chiefMourner": "대표 상주 한 명 (장례식인 경우만, 아니면 빈 문자열). '○○ 드림'에 적힌 사람이 있으면 그 사람, 없으면 상주 명단의 첫 사람",
  "mourners": [{"rel": "관계(배우자·아들·딸·며느리·사위·손 등)", "name": "이름"}],
  "noWreath": true | false,
  "noWreathText": "화환·조화를 사양한다는 원문 한 줄. 없으면 빈 문자열",
  "confidence": "high" | "medium" | "low"
}

규칙:
- 결혼식 안내면 type을 "wedding", 장례/부고면 "funeral"로 설정.
- 날짜는 반드시 YYYY-MM-DD로 변환. 연도가 없으면 맨 앞에 적힌 오늘 날짜 기준으로 가장 가까운 날로 정한다.
- 장례식 이름: "故 ○○", "고 ○○", "○○님께서 별세(소천)", "○○ 본인상"의 ○○는 고인. "○○ 부친상·모친상·빙부상·빙모상·시부상·시모상·조부상·조모상·배우자상", "○○의 부친"의 ○○는 상주이고, 고인 이름이 따로 없으면 recipientName 은 빈 문자열.
- mourners 는 장례식 상주·유족 명단을 적힌 순서대로 최대 8명. 한 관계에 여러 명이면 사람마다 따로 적는다. 전화번호·계좌는 절대 넣지 않는다. 결혼식이거나 명단이 없으면 [].
- chiefMourner(대표 상주)는 "○○ 드림"에 적힌 사람, 없으면 맏아들(장남, 아들 가운데 첫 사람), 아들이 없으면 명단의 첫 사람.
- [링크 페이지]와 [붙여넣은 글]이 같이 오면 링크 페이지가 더 최근이다. 둘이 다르면 링크 페이지를 따른다. [페이지 요약]은 그 부고장이 스스로 정리한 핵심이다.
- 장례식에 이름이 하나뿐이고 위 단서가 없으면 고인으로 본다. 고인과 상주는 같은 사람일 수 없으니 두 칸에 같은 이름을 넣지 않는다.
- 확실하지 않은 필드는 추측하지 말고 빈 문자열로 둔다.
- 정보가 거의 없으면 confidence를 "low"로.
- "화환은 정중히 사양합니다", "조화 사절", "부의금·화환 받지 않습니다"처럼 화환을 받지 않는다는 말이 분명히 있을 때만 noWreath 를 true 로. 애매하면 false.
- 이미지(캡처)가 오면 그 안의 글자를 읽어 같은 형식으로 답한다.`;

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

    // ── 리본 문구 도우미 ──
    // body: {action:"ribbon", mode:"suggest", type:"condolence", desc:"직장 상사 어머님 상"}
    //       → {ok, items:["삼가 고인의 명복을 빕니다", ...]}
    // body: {action:"ribbon", mode:"check", type:"condolence", left:"...", right:"..."}
    //       → {ok, warn:null|"장례용인데 축하 표현입니다"}
    // 실패는 전부 조용히 빈 결과(fail-open) — 주문을 절대 막지 않는다.
    if (early && early.action === "ribbon") {
      // 프론트는 행사 성격(order.type: wedding/funeral/unknown)과 상품 분류(order.category)를 따로 들고 있다.
      // 상품 분류가 근조·축하로 확정돼 있으면 그게 더 정확하다.
      const t = String(early.type || "");
      const c = String(early.cat || "");
      const kindLabel =
        c === "condolence" || t === "funeral" ? "장례(근조)"
        : c === "congrats" ? "개업·승진 등 축하"
        : t === "wedding" ? "결혼"
        : "경조사";

      if (early.mode === "check") {
        const left = String(early.left || "").trim().slice(0, 120);
        const right = String(early.right || "").trim().slice(0, 120);
        if (!right) return res.status(200).json({ ok: true, warn: null });
        const r = await askClaude({
          maxTokens: 200, timeoutMs: 5000,
          system:
            "너는 화환 리본 문구를 검수한다. 잘못된 문구가 장례식장이나 개업식에 걸리면 되돌릴 수 없으므로 신중하되, 확실할 때만 지적한다.\n" +
            "다음 경우에만 경고한다: (1) 행사 성격과 정반대인 표현(장례에 축하, 축하에 조의) (2) 명백한 오탈자 (3) 왼편·오른편이 뒤바뀐 경우.\n" +
            '문제가 없으면 {"warn":null} 만 출력한다. 문제가 있으면 {"warn":"무엇이 왜 잘못됐는지 한 문장, 존댓말"} 형식의 JSON만 출력한다.\n' +
            "표현 취향이나 격식 수준은 지적하지 않는다. 설명·마크다운 없이 JSON만.",
          content: `행사: ${kindLabel}\n리본 왼편(보내는 분): ${left || "(비어 있음)"}\n리본 오른편(문구): ${right}`,
        });
        if (!r.ok) return res.status(200).json({ ok: true, warn: null });
        const j = extractJson(r.text);
        const warn = j && typeof j.warn === "string" && j.warn.trim() ? j.warn.trim().slice(0, 200) : null;
        return res.status(200).json({ ok: true, warn });
      }

      const desc = String(early.desc || "").trim().slice(0, 200);
      if (desc.length < 2) return res.status(200).json({ ok: true, items: [] });
      const r = await askClaude({
        maxTokens: 400, timeoutMs: 8000,
        system:
          "너는 한국 화환 리본의 오른편 문구를 추천한다. 관습을 지키는 것이 가장 중요하다.\n" +
          "규칙: 문구는 8자 이상 20자 이하. 서로 다른 3개. 흔하고 안전한 표현을 우선한다.\n" +
          "고인·수신인 이름이나 회사명은 넣지 않는다(그건 왼편에 들어간다).\n" +
          '{"items":["문구1","문구2","문구3"]} 형식의 JSON만 출력한다. 설명·마크다운 금지.',
        content: `행사: ${kindLabel}\n보내는 분이 설명한 관계·상황: ${desc}`,
      });
      if (!r.ok) return res.status(200).json({ ok: true, items: [] });
      const j = extractJson(r.text);
      const items = Array.isArray(j && j.items)
        ? j.items.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim().slice(0, 40)).slice(0, 3)
        : [];
      return res.status(200).json({ ok: true, items });
    }

    // ── 자연어 상품 검색 ──
    // body: {action:"search", q:"5만원대 개업 축하 난", cats:[...]}  → {ok, filter:{...}}
    // 상품 목록은 프론트가 이미 들고 있으므로 여기서는 '조건'만 해석해 돌려준다(토큰 절약).
    if (early && early.action === "search") {
      const q = String(early.q || "").trim().slice(0, 120);
      if (q.length < 2) return res.status(200).json({ ok: true, filter: null });
      const r = await askClaude({
        maxTokens: 300, timeoutMs: 7000,
        system:
          "너는 꽃집 검색어를 필터 조건으로 바꾼다. JSON만 출력한다.\n" +
          '형식: {"cat":"","sub":"","minPrice":null,"maxPrice":null,"keyword":"","occasion":""}\n' +
          "cat 은 bouquet(꽃다발)/basket(꽃바구니)/plant(관엽)/orchid(난)/congrats(축하화환)/condolence(근조화환) 중 하나 또는 빈 문자열.\n" +
          "occasion 은 wedding/opening/promotion/birthday/visit/funeral 중 하나 또는 빈 문자열.\n" +
          "가격은 원 단위 숫자. '5만원대'는 min 50000 max 59999, '10만원 이하'는 max 100000 처럼 해석한다.\n" +
          "keyword 는 품종명이나 색처럼 이름으로 걸러낼 말만. 확실하지 않은 항목은 비워 둔다. 지어내지 않는다.",
        content: q,
      });
      if (!r.ok) return res.status(200).json({ ok: true, filter: null });
      const j = extractJson(r.text);
      if (!j || typeof j !== "object") return res.status(200).json({ ok: true, filter: null });
      const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : null);
      const str = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
      return res.status(200).json({
        ok: true,
        filter: {
          cat: str(j.cat, 20), sub: str(j.sub, 20), keyword: str(j.keyword, 30),
          occasion: str(j.occasion, 20), minPrice: num(j.minPrice), maxPrice: num(j.maxPrice),
        },
      });
    }
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

    // ── 주소 추천 (행정안전부 도로명주소 검색 API 프록시, 10/26) ──
    // body: {action:"addr", q:"화양동 46-5"} → {ok, items:[{road, jibun, zip, bd}]}
    // 주문서 주소칸에 치는 동안 아래에 실제 주소를 띄운다. 동네만 쳐도 시·군·구까지 맞춰져 먼 지역 배송비가 빠지지 않는다.
    // JUSO_API_KEY(business.juso.go.kr 운영 승인키) 미설정·장애 시 빈 목록(fail-open) — 다음 우편번호 검색 버튼은 그대로 쓴다.
    if (early && early.action === "addr") {
      // 도로명주소 API 는 특수문자와 SQL 예약어가 든 검색어를 오류로 돌려보낸다.
      const q = String(early.q || "")
        .replace(/[%=<>\[\]{}"'`;\\]/g, " ")
        .replace(/\b(OR|SELECT|INSERT|DELETE|UPDATE|CREATE|DROP|EXEC|UNION|FETCH|DECLARE|TRUNCATE)\b/gi, " ")
        .replace(/\s+/g, " ").trim().slice(0, 60);
      if (q.length < 2 || !/[가-힣0-9]/.test(q)) return res.status(200).json({ ok: true, items: [] });
      const key = process.env.JUSO_API_KEY;
      // why: 왜 비었는지(키 없음·HTTP·API 오류 코드). 키 값은 절대 싣지 않는다.
      if (!key) return res.status(200).json({ ok: true, items: [], skip: true, why: "nokey" });
      try {
        const r = await fetch(
          `https://business.juso.go.kr/addrlink/addrLinkApi.do?confmKey=${encodeURIComponent(key)}&currentPage=1&countPerPage=7&keyword=${encodeURIComponent(q)}&resultType=json`,
          { signal: AbortSignal.timeout(4000) }
        );
        if (!r.ok) return res.status(200).json({ ok: true, items: [], skip: true, why: "http" + r.status });
        const j = await r.json();
        const c = (j && j.results && j.results.common) || {};
        if (String(c.errorCode) !== "0") {
          console.error("addr juso:", c.errorCode, c.errorMessage);
          return res.status(200).json({ ok: true, items: [], skip: true, why: "juso:" + String(c.errorCode || "?").slice(0, 10) + " " + String(c.errorMessage || "").slice(0, 60) });
        }
        const s = (v, n) => String(v || "").replace(/\s+/g, " ").trim().slice(0, n);
        const items = (Array.isArray(j.results.juso) ? j.results.juso : []).slice(0, 7)
          .map((x) => ({ road: s(x.roadAddrPart1, 80), jibun: s(x.jibunAddr, 80), zip: /^\d{5}$/.test(String(x.zipNo)) ? String(x.zipNo) : "", bd: s(x.bdNm, 40) }))
          .filter((x) => x.road);
        return res.status(200).json({ ok: true, items, total: Number(c.totalCount) || items.length });
      } catch (e) {
        console.error("addr error:", e && e.message);
        return res.status(200).json({ ok: true, items: [], skip: true, why: "error " + String((e && e.name) || "").slice(0, 30) });
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

    // ── 거래처: 계산서 재발행 요청 → 사장님 텔레그램 알림 (corp.html) ──
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
            body: JSON.stringify({ chat_id: tgc, text: `${tag}🧾 계산서 재발행 요청\n사업자번호 ${regno}${memo ? `\n메모: ${memo}` : ""}\n(거래처 대시보드에서 요청)`, disable_web_page_preview: true }),
          });
        } catch { /* 알림 실패는 무시 */ }
      }
      return res.status(200).json({ ok: true });
    }

    // ── 거래처: 월말 정산 요청 → 사장님 텔레그램 (corp.html, 10/20) ──
    // body: {action:"corpmonth", regno, token, month:"2026-10"} — 그 달 주문을 서버에서 다시 세어 건수·합계를 알린다(손님이 보낸 숫자는 안 믿는다).
    // ── 챙길 사람 수첩 (my.html, 10/20) ──
    // body: {action:"lunar", items:[{m,d}], y0:2026, n:10} → {ok, dates:[["2026-10-26",…],…]} 음력 날짜를 해마다 양력으로(D-day·달력 파일용)
    // body: {action:"askmake", at:<로그인 토큰>} → {ok, u, t} '생일 알려줘' 링크 열쇠(회원 id 를 서버 비밀로 서명, 표를 새로 안 만든다)
    // body: {action:"askreply", u, t, from, name, month, day, lunar, addr, phone} → {ok, id, dk} 받은 사람이 적은 생일을 그 회원 수첩에 넣는다
    // body: {action:"askdel", id, dk} → {ok} 적어 준 사람이 자기 기기에서 지운다
    if (early && /^(lunar|askmake|askreply|askdel)$/.test(String(early.action || ""))) {
      if (early.action === "lunar") {
        const KLC = (await import("korean-lunar-calendar")).default;
        const items = Array.isArray(early.items) ? early.items.slice(0, 100) : [];
        const y0 = Math.max(2000, Math.min(2100, Math.trunc(Number(early.y0)) || new Date().getFullYear()));
        const n = Math.max(1, Math.min(12, Math.trunc(Number(early.n)) || 2));
        const dates = items.map((x) => {
          const out = [];
          for (let y = y0; y < y0 + n; y++) {
            try {
              const c = new KLC();
              // 그해 음력 날짜가 없으면(작은달 30일) 29일로 당긴다
              if (!c.setLunarDate(y, Math.trunc(Number(x.m)), Math.trunc(Number(x.d)), false) && !c.setLunarDate(y, Math.trunc(Number(x.m)), Math.trunc(Number(x.d)) - 1, false)) { out.push(""); continue; }
              const s = c.getSolarCalendar();
              out.push(`${s.year}-${String(s.month).padStart(2, "0")}-${String(s.day).padStart(2, "0")}`);
            } catch { out.push(""); }
          }
          return out;
        });
        return res.status(200).json({ ok: true, dates });
      }
      const SECRET = process.env.CRON_SECRET || process.env.TOSS_SECRET_KEY || "";
      const URL_ = process.env.SUPABASE_URL, KEY_ = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!SECRET || !URL_ || !KEY_) return res.status(503).json({ error: "설정이 필요합니다." });
      const hdr = { apikey: KEY_, Authorization: `Bearer ${KEY_}` };
      const sign = (s) => crypto.createHmac("sha256", SECRET).update(s).digest("hex").slice(0, 24);
      const same = (x, y) => { const a = Buffer.from(String(x || "")), b = Buffer.from(String(y || "")); return a.length === b.length && crypto.timingSafeEqual(a, b); };
      const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
      try {
        if (early.action === "askmake") {
          const r = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: KEY_, Authorization: `Bearer ${String(early.at || "")}` } });
          const u = r.ok ? await r.json().catch(() => null) : null;
          if (!u || !u.id) return res.status(401).json({ error: "로그인이 필요해요." });
          return res.status(200).json({ ok: true, u: u.id, t: sign("ask:" + u.id) });
        }
        if (early.action === "askdel") {
          const id = String(early.id || "");
          if (!/^[0-9a-f-]{36}$/.test(id) || !same(early.dk, sign("askdel:" + id))) return res.status(401).json({ error: "지울 수 없어요." });
          const d = await fetch(`${URL_}/rest/v1/anniversaries?id=eq.${id}`, { method: "DELETE", headers: hdr });
          return res.status(d.ok ? 200 : 502).json(d.ok ? { ok: true } : { error: "잠시 후 다시 시도해 주세요." });
        }
        // askreply
        const uid = String(early.u || "");
        if (!/^[0-9a-f-]{36}$/.test(uid) || !same(early.t, sign("ask:" + uid))) return res.status(401).json({ error: "링크가 올바르지 않아요." });
        const name = str(early.name, 20), month = Math.trunc(Number(early.month)), day = Math.trunc(Number(early.day));
        if (!name || !(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return res.status(400).json({ error: "이름과 생일을 적어 주세요." });
        // 한 링크로 수첩이 넘치지 않게(회원 한 명당 300칸)
        const cnt = await fetch(`${URL_}/rest/v1/anniversaries?user_id=eq.${uid}&select=id`, { headers: { ...hdr, Prefer: "count=exact", Range: "0-0" } });
        const total = Number(String(cnt.headers.get("content-range") || "").split("/")[1]) || 0;
        if (total >= 300) return res.status(429).json({ error: "수첩이 가득 찼어요." });
        const base = { user_id: uid, recipient: name, label: "생일", month, day, cal_type: early.lunar ? "lunar" : "solar" };
        const extra = { addr: str(early.addr, 120), phone: str(early.phone, 20).replace(/[^0-9-]/g, ""), via: "ask" };
        const ins = (row) => fetch(`${URL_}/rest/v1/anniversaries`, { method: "POST", headers: { ...hdr, "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(row) });
        let r = await ins({ ...base, ...extra });
        if (!r.ok) r = await ins(base);   // 칸 늘리는 SQL(supabase-anniv-people.sql) 전이면 주소·전화 없이
        if (!r.ok) return res.status(502).json({ error: "잠시 후 다시 시도해 주세요." });
        const row = (await r.json().catch(() => []))[0] || {};
        return res.status(200).json({ ok: true, id: row.id, dk: row.id ? sign("askdel:" + row.id) : "" });
      } catch (e) {
        console.error(early.action + " error:", e && e.message);
        return res.status(502).json({ error: "잠시 후 다시 시도해 주세요." });
      }
    }

    // ── 거래처: 직원 생일 명단 (corp.html, 10/20) ──
    // body: {action:"corpbd", regno, token, mode:"list"} → {ok, rows}
    //       {action:"corpbd", regno, token, mode:"save", rows:[{name,month,day,lunar,addr,phone,budget,msg}]} → 그 거래처 명단을 통째로 바꾼다.
    // 표는 supabase-corp-birthdays.sql. 아직 없으면 {ok:false, setup:true} 로 알려 화면이 '준비 중'을 띄운다.
    if (early && (early.action === "corpmonth" || early.action === "corpbd")) {
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
      const tg = process.env.TELEGRAM_BOT_TOKEN, tgc = process.env.TELEGRAM_CHAT_ID;
      const tag = process.env.PROJECT_TAG ? `[${process.env.PROJECT_TAG}] ` : "";
      const tell = async (text) => {
        if (!tg || !tgc) return;
        try {
          await fetch(`https://api.telegram.org/bot${tg}/sendMessage`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: tgc, text: tag + text, disable_web_page_preview: true }),
          });
        } catch { /* 알림 실패는 무시 */ }
      };
      try {
        if (early.action === "corpmonth") {
          const mo = String(early.month || "");
          if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mo)) return res.status(400).json({ error: "달이 올바르지 않습니다." });
          const [y, mm] = mo.split("-").map(Number);
          const next = mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, "0")}`;
          // created_at 은 UTC 라 한국 날짜 경계(-9시간)로 자른다
          const r = await fetch(`${URL_}/rest/v1/orders?corp_regno=eq.${regno}&created_at=gte.${mo}-01T00:00:00%2B09:00&created_at=lt.${next}-01T00:00:00%2B09:00&select=amount,status,corp_name&limit=500`, { headers: hdr });
          if (!r.ok) return res.status(502).json({ error: "주문을 불러오지 못했습니다." });
          const rows = (await r.json().catch(() => [])).filter((o) => o.status !== "canceled");
          const sum = rows.reduce((t, o) => t + (Number(o.amount) || 0), 0);
          const memo = String(early.memo || "").replace(/\s+/g, " ").trim().slice(0, 200);
          await tell(`🧾 월말 정산 요청\n${(rows[0] && rows[0].corp_name) || "거래처"} (${regno})\n${mo} · ${rows.length}건 · ${sum.toLocaleString("ko-KR")}원${memo ? `\n메모: ${memo}` : ""}\n(거래처 대시보드에서 요청)`);
          return res.status(200).json({ ok: true, count: rows.length, sum });
        }
        // corpbd
        const T = `${URL_}/rest/v1/corp_birthdays`;
        if (early.mode === "save") {
          const raw = Array.isArray(early.rows) ? early.rows.slice(0, 500) : [];
          const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
          const rows = raw.map((x) => ({
            corp_regno: regno, name: str(x.name, 30),
            month: Math.trunc(Number(x.month)), day: Math.trunc(Number(x.day)), lunar: !!x.lunar,
            addr: str(x.addr, 120), phone: str(x.phone, 20).replace(/[^0-9-]/g, ""),
            budget: Math.max(0, Math.min(1000000, Math.round(Number(x.budget) || 0))), msg: str(x.msg, 80),
          })).filter((x) => x.name && x.month >= 1 && x.month <= 12 && x.day >= 1 && x.day <= 31);
          const del = await fetch(`${T}?corp_regno=eq.${regno}`, { method: "DELETE", headers: hdr });
          if (del.status === 404) return res.status(200).json({ ok: false, setup: true });
          if (!del.ok) return res.status(502).json({ error: "명단을 저장하지 못했습니다." });
          if (rows.length) {
            const ins = await fetch(T, { method: "POST", headers: { ...hdr, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(rows) });
            if (!ins.ok) return res.status(502).json({ error: "명단을 저장하지 못했습니다." });
          }
          await tell(`🎂 거래처 직원 생일 명단 ${rows.length}명 저장\n사업자번호 ${regno}\n(생일 7일 전에 여기로 알려 드려요)`);
          return res.status(200).json({ ok: true, saved: rows.length });
        }
        const r = await fetch(`${T}?corp_regno=eq.${regno}&select=name,month,day,lunar,addr,phone,budget,msg&order=month.asc,day.asc&limit=500`, { headers: hdr });
        if (r.status === 404) return res.status(200).json({ ok: false, setup: true });
        if (!r.ok) return res.status(502).json({ error: "명단을 불러오지 못했습니다." });
        return res.status(200).json({ ok: true, rows: await r.json().catch(() => []) });
      } catch (e) {
        console.error(early.action + " error:", e && e.message);
        return res.status(502).json({ error: "잠시 후 다시 시도해 주세요." });
      }
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

    const { url, text, image } = body;

    // 캡처 사진(부고·청첩장 이미지) — data URL(jpeg/png/webp), 4MB 이하. 글자를 읽어 같은 JSON 으로 답한다.
    if (typeof image === "string" && image) {
      const m = image.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
      if (!m) return res.status(400).json({ error: "사진 형식을 읽지 못했어요." });
      if (m[2].length > 4_000_000) return res.status(413).json({ error: "사진이 너무 커요. 화면을 캡처한 사진으로 다시 해 주세요." });
      const r = await askClaude({
        system: SYSTEM_PROMPT, maxTokens: 1024, timeoutMs: 25000,
        content: [
          { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } },
          { type: "text", text: `오늘은 ${kstToday()} 입니다. 이 이미지는 청첩장·부고 캡처입니다. 화환 배송 정보를 추출해 JSON으로만 응답하세요.` },
        ],
      });
      const j = r.ok ? extractJson(r.text) : null;
      if (!j || typeof j !== "object") return res.status(422).json({ error: "사진에서 내용을 읽지 못했어요. 링크를 붙여넣거나 전화(1577-2286) 주세요." });
      return res.status(200).json({ ok: true, result: fixParsed(j, "", Date.now(), funeralHomes()) });
    }

    // 카톡 부고 문자처럼 글과 링크가 같이 오면 둘 다 읽는다. 링크 페이지가 비어 있거나 못 열려도 글로 채운다(10/26).
    const pasted = typeof text === "string" ? text.trim().slice(0, 4000) : "";
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
      try {
        const page = await fetchPageText(parsed.toString());
        // 빈 화면만 오는 부고장(브라우저에서 그리는 곳)은 읽을 게 없다. 글이 같이 왔으면 글로, 아니면 캡처·문자를 안내한다.
        if (page.hangul >= 8) sourceText = page.text;
        else if (!pasted) return res.status(422).json({ error: THIN_MSG, code: "thin" });
      } catch (e) {
        if (!pasted) throw e;
      }
      if (pasted) sourceText = (sourceText ? `[링크 페이지]\n${sourceText}\n\n` : "") + `[붙여넣은 글]\n${pasted}`;
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
            content: `오늘은 ${kstToday()} 입니다. 다음 안내문에서 화환 배송 정보를 추출해 JSON으로만 응답하세요:\n\n${sourceText}`,
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

    return res.status(200).json({ ok: true, result: fixParsed(parsed, sourceText, Date.now(), funeralHomes()) });
  } catch (err) {
    console.error("parse-url error:", err);
    return res
      .status(500)
      .json({ error: err.message || "알 수 없는 오류가 발생했습니다." });
  }
}
