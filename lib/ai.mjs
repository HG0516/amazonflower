// lib/ai.mjs
// Claude 호출 공용 헬퍼. api/ 밖에 두었으므로 Vercel 서버리스 함수로 잡히지 않는다
// (함수 12개 한도가 꽉 찬 상태라 api/ 안에 새 파일을 만들면 안 된다).
//
// 설계 원칙: 절대 throw 하지 않는다. AI가 죽어도 주문·결제·알림은 그대로 돌아가야 하므로
// 실패는 { ok:false } 로만 알리고 호출부가 조용히 건너뛴다(fail-open).

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

/** 추출·분류·짧은 요약 위주라 Sonnet. 모델을 바꾸려면 여기 한 줄만 고치면 된다. */
export const AI_MODEL = "claude-sonnet-5";

/**
 * @param {object}   o
 * @param {string}   o.system      시스템 프롬프트
 * @param {string|Array} o.content 사용자 메시지(문자열 또는 content 블록 배열 — 이미지 포함 가능)
 * @param {number}  [o.maxTokens]
 * @param {number}  [o.timeoutMs]  이 시간을 넘기면 포기한다. 손님을 기다리게 두지 않는다.
 * @returns {Promise<{ok:true,text:string}|{ok:false,reason:string}>}
 */
export async function askClaude({ system, content, maxTokens = 1024, timeoutMs = 12000 }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, reason: "no_key" };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content }],
      }),
    });
    if (!r.ok) {
      console.error("askClaude http", r.status, (await r.text().catch(() => "")).slice(0, 300));
      return { ok: false, reason: `http_${r.status}` };
    }
    const data = await r.json();
    // 안전장치가 요청을 거절하면 stop_reason 이 refusal 로 온다. content 를 그냥 읽으면 안 된다.
    if (data.stop_reason === "refusal") return { ok: false, reason: "refusal" };
    const text = (data.content || [])
      .filter((b) => b && b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!text) return { ok: false, reason: "empty" };
    return { ok: true, text };
  } catch (e) {
    console.error("askClaude error", e && e.message);
    return { ok: false, reason: e && e.name === "AbortError" ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}

/** 코드블록이나 앞뒤 설명이 섞여 와도 JSON 부분만 건져낸다. 실패하면 null. */
export function extractJson(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/[[{][\s\S]*[\]}]/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}
