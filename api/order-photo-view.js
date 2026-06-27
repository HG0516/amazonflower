// api/order-photo-view.js
// 배송완료 사진을 '본인에게만' 안전하게 내려주는 프록시.
//  - Authorization: Bearer <로그인 access_token> 으로 사용자 확인
//  - 해당 user_id 의 주문(order_id)인지 검증(타인 주문 사진 차단)
//  - service_role 로 비공개 버킷(order-photos) 객체를 받아 이미지 바이트로 프록시
// 공개 URL을 노출하지 않으므로 URL이 새어도 타인은 볼 수 없다.

export const config = { runtime: "nodejs" };

const BUCKET = "order-photos";

export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(503).json({ error: "서버 설정 오류" });

  const auth = req.headers.authorization || req.headers.Authorization || "";
  const m = String(auth).match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: "로그인이 필요합니다." });

  let oid = "";
  try { oid = new URL(req.url, "http://localhost").searchParams.get("order") || ""; }
  catch { oid = (req.query && req.query.order) || ""; }
  if (!oid) return res.status(400).json({ error: "order 파라미터가 필요합니다." });

  // 1) 토큰 → 사용자 확인
  let uid = null;
  try {
    const ur = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${m[1]}` } });
    if (!ur.ok) return res.status(401).json({ error: "유효하지 않은 로그인입니다." });
    const u = await ur.json();
    uid = u && u.id;
  } catch { return res.status(401).json({ error: "인증 확인 실패" }); }
  if (!uid) return res.status(401).json({ error: "유효하지 않은 로그인입니다." });

  // 2) 본인 주문의 completed_photo(경로) — user_id 일치 필수
  let path = null;
  try {
    const or = await fetch(
      `${SUPABASE_URL}/rest/v1/orders?order_id=eq.${encodeURIComponent(oid)}&user_id=eq.${encodeURIComponent(uid)}&select=completed_photo&limit=1`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    const rows = await or.json().catch(() => []);
    path = Array.isArray(rows) && rows[0] ? rows[0].completed_photo : null;
  } catch { return res.status(502).json({ error: "조회 실패" }); }
  if (!path) return res.status(404).json({ error: "사진이 없거나 접근 권한이 없습니다." });

  // 옛 데이터가 전체 URL로 저장돼 있을 수 있음 → 버킷 내부 경로만 추출
  if (/^https?:\/\//i.test(path)) {
    const mm = path.match(/\/object\/(?:public|sign)\/[^/]+\/(.+)$/);
    path = mm ? decodeURIComponent(mm[1].split("?")[0]) : path;
  }

  // 3) service_role 로 비공개 객체를 받아 그대로 프록시
  try {
    const obj = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURI(path)}`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
    if (!obj.ok) return res.status(404).json({ error: "사진을 찾을 수 없습니다." });
    const buf = Buffer.from(await obj.arrayBuffer());
    res.setHeader("Content-Type", obj.headers.get("content-type") || "image/jpeg");
    res.setHeader("Cache-Control", "private, max-age=60");
    return res.status(200).send(buf);
  } catch { return res.status(502).json({ error: "사진 로드 실패" }); }
}
