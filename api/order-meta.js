// 결제완료 화면의 1탭 설문("어떻게 알고 오셨어요?") 저장 전용 엔드포인트.
// 민감정보가 아니고(채널 이름 하나), 최초 1회만 기록(이미 값 있으면 무시)이라
// 주문번호 형식 검증만으로 받는다. 그 외 어떤 주문 필드도 이 경로로 수정 불가.
const ALLOWED = ["검색", "지인", "전단·현수막", "기타"];

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { order_id, referral_source } = req.body || {};
  if (!/^AF\d{8}-[A-Z0-9]{6}$/.test(String(order_id || ""))) {
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
