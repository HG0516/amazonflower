// 운영 DB 에 아직 없는 orders 칸 때문에 조회가 깨질 때의 대비책.
//
// 왜: 8/14 '1차 안전 묶음' 코드는 배포됐는데 supabase-first-bundle.sql 이 운영에 적용되지 않아
// orders 에 cancel_requested_at·photo_notice_*·payment_* 칸이 없다. 그 칸을 조회 목록이나 조건에
// 넣은 관리자 주문 목록·상태 변경·30분 마감 경고·브리핑·텔레그램 '발주 완료' 버튼이 전부
// 400(42703)으로 멈춰 있었다(2026-10-04 발견).
//
// 무엇: orders 를 부르는 요청이 '알려진 선택 칸이 없다' 오류로 실패하면, 그 칸만 빼고 다시 보낸다.
// 의미가 바뀌지 않는 경우에만 뺀다.
//   - select 목록·order 정렬에서 빼기          → 안전(읽는 칸이 줄 뿐)
//   - '칸=is.null' 조건 빼기                    → 안전(칸이 없으면 모든 행이 null 인 셈이라 항상 참)
//   - 쓰기 본문(PATCH/POST)에서 그 키 빼기       → 안전(없는 칸엔 원래 못 쓴다)
//   - 그 밖의 조건(eq·neq·in·not.is.null·or=…) → 빼면 결과가 달라진다 → 빼지 않고 원래 오류를 돌려준다
// SQL 이 적용되면 첫 요청이 그대로 성공하므로 이 경로는 쓰이지 않는다.
//
// 환불(취소 outbox)·배송사진 문자 경로는 이걸 쓰지 않는다 — 그 둘은 칸만이 아니라 SQL 이 만드는
// 표·함수에 기대고 있어서, 칸만 피해 가면 안전장치 없이 돈·문자가 나갈 수 있다.

const OPTIONAL_ORDER_COLUMNS = new Set([
  // supabase-first-bundle.sql
  "cancel_requested_at", "photo_notice_status", "photo_notified_at", "photo_notify_error",
  "photo_access_expires_at", "photo_notice_lease_until", "photo_notice_photo", "photo_access_token_hash",
  "payment_key", "payment_status", "payment_method", "approved_at", "receipt_url",
  // supabase-deposit-orders.sql
  "va_bank", "va_account", "va_due", "va_secret_hash", "deposited_at",
]);

export function missingOrderColumn(text) {
  const t = String(text || "");
  const m = t.match(/column orders\.([a-z_]+) does not exist/i)
    || t.match(/Could not find the '([a-z_]+)' column of 'orders'/i);
  return m ? m[1] : null;
}

// URL 에서 col 을 뺀 새 URL. 의미가 바뀌는 조건이면 null.
export function stripColumnFromUrl(urlStr, col) {
  let u;
  try { u = new URL(urlStr); } catch { return null; }
  const next = new URLSearchParams();
  for (const [k, v] of u.searchParams.entries()) {
    if (k === col) {
      if (v === "is.null") continue;          // 칸이 없으면 항상 참 → 빼도 같다
      return null;                            // 다른 조건은 흉내 낼 수 없다
    }
    if ((k === "or" || k === "and" || k === "not.or" || k === "not.and") && new RegExp(`\\b${col}\\b`).test(v)) return null;
    if (k === "select") {
      const cols = v.split(",").map((s) => s.trim()).filter((s) => s && s !== col);
      if (!cols.length) return null;
      next.append(k, cols.join(","));
      continue;
    }
    if (k === "order") {
      const parts = v.split(",").filter((s) => s.split(".")[0] !== col);
      if (parts.length) next.append(k, parts.join(","));
      continue;
    }
    next.append(k, v);
  }
  u.search = next.toString();
  return u.toString();
}

export function stripColumnFromBody(body, col) {
  if (typeof body !== "string") return body;
  let parsed;
  try { parsed = JSON.parse(body); } catch { return body; }
  const drop = (o) => {
    if (!o || typeof o !== "object" || Array.isArray(o)) return o;
    const { [col]: _gone, ...rest } = o;
    return rest;
  };
  return JSON.stringify(Array.isArray(parsed) ? parsed.map(drop) : drop(parsed));
}

const isOrdersUrl = (u) => /\/rest\/v1\/orders(?:\?|$)/.test(u);

// fetch 와 같은 모양. orders 가 아닌 요청(토스·텔레그램·다른 표)은 그대로 통과한다.
// 실제 fetch 는 부를 때마다 globalThis 에서 찾는다(시험의 가짜 fetch 가 그대로 쓰이게).
export async function compatFetch(input, init = {}) {
  const real = (...a) => globalThis.fetch(...a);
  let url = typeof input === "string" ? input : String(input && input.url || input);
  if (!isOrdersUrl(url)) return real(input, init);
  let opts = { ...init };
  for (let attempt = 0; attempt < 10; attempt++) {
    const res = await real(url, opts);
    if (res.status !== 400) return res;
    const text = await res.clone().text().catch(() => "");
    const col = missingOrderColumn(text);
    if (!col || !OPTIONAL_ORDER_COLUMNS.has(col)) return res;
    const nextUrl = stripColumnFromUrl(url, col);
    if (nextUrl == null) return res;
    const nextBody = opts.body != null ? stripColumnFromBody(opts.body, col) : opts.body;
    if (nextUrl === url && nextBody === opts.body) return res; // 뺄 것이 없으면 그만(무한 반복 방지)
    url = nextUrl;
    opts = { ...opts, body: nextBody };
  }
  return real(url, opts);
}

// lib/payment-integrity 의 fetchJsonWithTimeout 과 같은 반환 모양({ response, data, text }).
export async function compatFetchJson(url, options = {}, timeoutMs = 6000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const response = await compatFetch(url, { ...options, signal: ac.signal });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    return { response, data, text };
  } finally {
    clearTimeout(timer);
  }
}
