// api/naver-callback.js
// 네이버 인증 콜백 — code로 네이버 프로필(email) 받아 Supabase 사용자를 만들고,
// '매직링크(action_link)'로 리다이렉트해 정식 Supabase 세션을 발급한다(브라우저가 따라가며 #access_token 수신).
// 필요한 env: NAVER_CLIENT_ID, NAVER_CLIENT_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Supabase Authentication > URL Configuration 의 Redirect URLs 에 사이트 주소가 있어야 함.

export const config = { runtime: "nodejs" };

function page(res, status, title, sub) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(status).send(
    `<!doctype html><html lang="ko"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1"><title>네이버 로그인 — 꽃안부</title></head>`
    + `<body style="font-family:-apple-system,'Apple SD Gothic Neo',sans-serif;background:#f7f4ee;color:#1f1d18;min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;margin:0;">`
    + `<div><div style="font-size:48px;">🌸</div><h2 style="margin:14px 0 6px;font-size:19px;">${title}</h2>`
    + `<p style="color:#5a564d;font-size:14px;">${sub || ""}</p>`
    + `<a href="/" style="display:inline-block;margin-top:18px;color:#2d4a38;font-weight:700;">홈으로</a></div></body></html>`
  );
}

export default async function handler(req, res) {
  const CLIENT_ID = process.env.NAVER_CLIENT_ID;
  const CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const base = process.env.PUBLIC_BASE_URL || "https://amazonflower.vercel.app";
  if (!CLIENT_ID || !CLIENT_SECRET || !SUPABASE_URL || !SERVICE_KEY) {
    return page(res, 503, "네이버 로그인 미설정", "관리자에게 문의해주세요.");
  }

  let code = "", state = "";
  try {
    const u = new URL(req.url, "http://localhost");
    code = u.searchParams.get("code") || "";
    state = u.searchParams.get("state") || "";
  } catch (e) {}

  // CSRF: 쿠키 state 대조
  const cookie = req.headers.cookie || "";
  const cm = cookie.match(/naver_state=([a-f0-9]+)/);
  if (!code || !state || !cm || cm[1] !== state) {
    return page(res, 400, "로그인 검증 실패", "잠시 후 다시 시도해주세요.");
  }

  try {
    // 1) code → 네이버 access_token
    const tokenUrl = "https://nid.naver.com/oauth2.0/token"
      + `?grant_type=authorization_code&client_id=${encodeURIComponent(CLIENT_ID)}`
      + `&client_secret=${encodeURIComponent(CLIENT_SECRET)}&code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
    const tr = await fetch(tokenUrl);
    const token = await tr.json();
    if (!token.access_token) return page(res, 502, "네이버 인증 실패", "다시 시도해주세요.");

    // 2) 프로필(email, name)
    const pr = await fetch("https://openapi.naver.com/v1/nid/me", { headers: { Authorization: `Bearer ${token.access_token}` } });
    const prof = await pr.json();
    const r = prof && prof.response;
    const email = r && r.email;
    const name = r && (r.name || r.nickname);
    if (!email) return page(res, 400, "이메일 동의가 필요해요", "네이버 로그인 시 이메일 제공에 동의해주세요.");

    const sbAdmin = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };

    // 3) Supabase 사용자 생성(이미 있으면 422 — 무시). 이메일 확인됨 처리.
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST", headers: sbAdmin,
      body: JSON.stringify({ email: email, email_confirm: true, user_metadata: { name: name || "", provider: "naver" } }),
    }).catch(() => {});

    // 4) 매직링크 생성 → action_link (Supabase verify 후 사이트로 세션과 함께 리다이렉트)
    const gl = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: "POST", headers: sbAdmin,
      body: JSON.stringify({ type: "magiclink", email: email, options: { redirect_to: base } }),
    });
    const glj = await gl.json().catch(() => ({}));
    const actionLink = glj.action_link || (glj.properties && glj.properties.action_link);
    if (!actionLink) return page(res, 502, "세션 생성 실패", "다시 시도해주세요.");

    // 5) action_link 로 리다이렉트 → 브라우저가 Supabase verify 거쳐 사이트로(#access_token) → auth.js 가 세션 처리
    res.setHeader("Set-Cookie", "naver_state=; Path=/; Max-Age=0");
    res.setHeader("Location", actionLink);
    return res.status(302).end();
  } catch (e) {
    return page(res, 500, "오류가 발생했어요", "잠시 후 다시 시도해주세요.");
  }
}
