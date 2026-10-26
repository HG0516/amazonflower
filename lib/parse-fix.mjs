// lib/parse-fix.mjs — 부고·청첩장 자동읽기(api/parse-url) 결과를 규칙으로 바로잡는다(2026-10-26 형구).
//
// AI 가 자주 틀리던 것:
// 1) 연도가 없는 날짜를 지난해로 읽는다. 청첩장 "11월 14일" → 2025-11-14 로 와서 손님이 '지난 날짜' 안내를 봤다.
//    글에 그 연도가 적혀 있지 않으면 오늘(KST) 기준 가장 가까운 날로 옮긴다. 60일 넘게 지난 날이면 내년으로 본다.
// 2) "영업2팀 김철수 과장 부친상"처럼 유족 이름만 있는 부고에서 고인·상주 두 칸에 같은 이름을 넣는다.
//    고인과 상주는 같은 사람일 수 없다. "부친상·모친상" 앞 이름이면 상주로, 故·별세 앞 이름이거나 단서가 없으면 고인으로 둔다.
//    바꾼 경우 nameCheck("mourner" | "deceased")를 붙여 주문서가 손님에게 확인을 부탁한다.

const DAY = 86400000;
const RELS = "부친|모친|빙부|빙모|시부|시모|시아버지|시어머니|조부|조모|장인|장모|배우자|남편|부인|아내|부군";

export function kstToday(now = Date.now()) {
  return new Date(Number(now) + 9 * 3600000).toISOString().slice(0, 10);
}

function addDays(ymd, n) {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}

function realDate(ymd) {
  const t = Date.parse(`${ymd}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === ymd;
}

export function fixYear(date, src, today) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ""));
  if (!m || date >= today) return date;
  const s = String(src || "");
  const yy = m[1].slice(2);
  if (s.includes(m[1]) || new RegExp(`(^|[^\\d])${yy}\\s*(년|[./])`).test(s)) return date;
  const y = Number(today.slice(0, 4));
  let c = `${y}-${m[2]}-${m[3]}`;
  if (c < addDays(today, -60)) c = `${y + 1}-${m[2]}-${m[3]}`;
  return realDate(c) ? c : date;
}

export function normName(s) {
  return String(s || "").replace(/^\s*故\s*/, "").replace(/^\s*고\s+/, "").replace(/\s+/g, "").replace(/님$/, "");
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isMourner = (flat, n) => new RegExp(`${esc(n)}[가-힣]{0,5}?(?:${RELS})`).test(flat);
const isDeceased = (flat, n) => new RegExp(`(?:故|고)${esc(n)}|${esc(n)}님?(?:께서)?(?:별세|소천|영면|본인상)`).test(flat);

export function fixNames(j, src) {
  if (!j || j.type !== "funeral") return j;
  const a = normName(j.recipientName), b = normName(j.chiefMourner);
  const flat = String(src || "").replace(/\s+/g, "");
  if (a && a === b) {
    if (isMourner(flat, a) && !isDeceased(flat, a)) { j.recipientName = ""; j.nameCheck = "mourner"; }
    else { j.chiefMourner = ""; j.nameCheck = "deceased"; }
  } else if (a && !b && flat && isMourner(flat, a) && !isDeceased(flat, a)) {
    // 상주 이름을 고인 칸에 넣은 경우
    j.chiefMourner = j.recipientName; j.recipientName = ""; j.nameCheck = "mourner";
  }
  return j;
}

// 3) 상주 명단(mourners)은 주문서의 '상주 고르기' 버튼에 쓴다. 이름과 관계만 남기고 숫자(전화·계좌)는 버린다.
export function fixMourners(j) {
  if (!j || typeof j !== "object") return j;
  const list = j.type === "funeral" && Array.isArray(j.mourners) ? j.mourners : [];
  const seen = new Set();
  j.mourners = list
    .map((m) => ({
      rel: String((m && m.rel) || "").replace(/[^가-힣a-zA-Z]/g, "").slice(0, 8),
      name: String((m && m.name) || "").replace(/[^가-힣a-zA-Z\s]/g, "").replace(/\s+/g, " ").trim().slice(0, 12),
    }))
    .filter((m) => m.name.replace(/\s/g, "").length >= 2 && !seen.has(normName(m.name)) && seen.add(normName(m.name)))
    .slice(0, 8);
  return j;
}

export function fixParsed(j, src = "", now = Date.now()) {
  if (!j || typeof j !== "object") return j;
  const today = kstToday(now);
  if (j.date) j.date = fixYear(j.date, src, today);
  return fixMourners(fixNames(j, src));
}
