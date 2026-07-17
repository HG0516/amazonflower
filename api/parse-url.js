// api/parse-url.js
// 청첩장/부고 URL 또는 직접 입력 텍스트를 받아 Claude API로 파싱한다.
// 보안: ANTHROPIC_API_KEY는 이 서버 함수 안에서만 사용된다. 프론트에 절대 노출되지 않는다.

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
        const items = [...byBzno.values()].slice(0, 6).map((it) => ({
          name: String(it.corpNm || "").slice(0, 60),
          bzno: String(it.bzno),
          addr: String(it.enpBsadr || "").slice(0, 80),
        }));
        return res.status(200).json({ ok: true, items });
      } catch (e) {
        console.error("corpsearch error:", e && e.message);
        return res.status(200).json({ ok: true, items: [], skip: true });
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
