// api/naver-login.js
// 네이버 로그인 시작 — 네이버 인증 페이지로 보낸다. (Supabase는 네이버 미지원이라 백엔드로 직접 처리)
// 필요한 env: NAVER_CLIENT_ID. 콜백은 /api/naver-callback.
// 네이버 개발자센터에 Callback URL 로 https://amazonflower.vercel.app/api/naver-callback 등록 필요.

import crypto from "node:crypto";

export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  const CLIENT_ID = process.env.NAVER_CLIENT_ID;
  const base = process.env.PUBLIC_BASE_URL || "https://amazonflower.vercel.app";
  if (!CLIENT_ID) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(503).send("네이버 로그인이 아직 설정되지 않았어요. (NAVER_CLIENT_ID 필요)");
  }
  const state = crypto.randomBytes(16).toString("hex");
  const redirect = `${base}/api/naver-callback`;
  // CSRF 방지용 state 를 짧은 수명 쿠키에 저장(콜백에서 대조)
  res.setHeader("Set-Cookie", `naver_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  const url = "https://nid.naver.com/oauth2.0/authorize"
    + `?response_type=code&client_id=${encodeURIComponent(CLIENT_ID)}`
    + `&redirect_uri=${encodeURIComponent(redirect)}&state=${state}`;
  res.setHeader("Location", url);
  res.status(302).end();
}
