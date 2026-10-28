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

// 4) 링크 페이지에서 글 뽑기. 카톡 미리보기용 요약(og:description)에 "○○○ 별세 | ○○장례식장 특실 | 발인 10.26(월) 22:00"처럼
//    핵심을 정리해 두는 부고장이 많은데 예전엔 태그와 함께 버렸다. 화면을 브라우저에서 그리는 부고장은 본문 대신
//    <script> 안 데이터(JSON)에 이름·빈소·발인이 들어 있어서 한글이 든 값을 꺼내 붙인다(10/26).
//    데이터를 <div id="app" data-page="{&quot;...">처럼 태그 꼬리표(속성)에 넣는 청첩장(더모드 theirmood.com, Inertia 방식)도 있어서
//    &quot; 가 든 data- 꼬리표도 풀어서 같이 읽는다. 예전엔 꼬리표째 버려 이름만 남고 예식장·주소·날짜가 빠졌다(10/28 릉래 제보).
//    hangul 은 한글 글자 수. 8자도 안 되면(의전나라처럼 빈 화면) 읽을 게 없다고 보고 캡처·문자 붙여넣기를 안내한다.
const KEY_HINT = /name|nm|hall|room|floor|binso|burial|balin|out|funeral|deceas|chief|mourn|sangju|addr|place|date|time|hour|minute|age/i;
function decodeEntities(s) {
  const cp = (n) => { try { return String.fromCodePoint(n); } catch { return " "; } };
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, x) => cp(parseInt(x, 16)))
    .replace(/&#(\d+);/g, (_, d) => cp(Number(d)))
    .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}
export function pageToText(html) {
  const h = String(html || "");
  const meta = [];
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(h);
  if (title) meta.push(title[1]);
  for (const m of h.matchAll(/<meta\b[^>]*>/gi)) {
    if (!/(?:property|name)\s*=\s*["'](?:og:title|og:description|description|twitter:description)["']/i.test(m[0])) continue;
    const c = /content\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[0]);
    if (c) meta.push(c[1] ?? c[2]);
  }
  const body = h.replace(/<head\b[\s\S]*?<\/head>/i, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
  const hot = [], rest = [];
  const blobs = [...h.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  for (const a of h.matchAll(/\sdata-[\w-]+\s*=\s*"([^"]*&quot;[^"]*)"/gi)) blobs.push(decodeEntities(a[1]));
  for (const blob of blobs) {
    for (const kv of blob.matchAll(/"([A-Za-z_]\w{0,40})"\s*:\s*(?:"((?:[^"\\]|\\.){1,300})"|(\d{1,4})(?=\s*[,}]))/g)) {
      const hotKey = KEY_HINT.test(kv[1]);
      if (kv[3] != null) { if (hotKey && /hour|minute|time/i.test(kv[1])) hot.push(`${kv[1]}: ${kv[3]}`); continue; }
      let v = kv[2];
      try { v = JSON.parse(`"${v}"`); } catch { /* 그대로 */ }
      if (/[가-힣]/.test(v) || (hotKey && /\d/.test(v))) (hotKey ? hot : rest).push(`${kv[1]}: ${v}`);
    }
  }
  const clean = (s) => decodeEntities(s).replace(/\s+/g, " ").trim();
  const uniq = (a) => [...new Set(a.map(clean).filter(Boolean))];
  const metaT = uniq(meta).join("\n"), bodyT = clean(body).slice(0, 6000), dataT = uniq([...hot, ...rest]).join("\n").slice(0, 3000);
  const text = [metaT && `[페이지 요약]\n${metaT}`, bodyT && `[본문]\n${bodyT}`, dataT && `[페이지 데이터]\n${dataT}`].filter(Boolean).join("\n\n");
  return { text, hangul: (`${metaT} ${bodyT} ${dataT}`.match(/[가-힣]/g) || []).length };
}

// 5) 교차 확인. AI 답을 글에 그대로 적힌 것과 맞춰 본다.
//    발인: "발인 2026.10.26(월) 22:00", "발인일 2026년 10월 28일(수) 09시 00분", "발인 10월 28일 오전 7시" 같은 줄을 규칙으로 읽는다.
//    글에 적힌 발인이 AI 답과 다르면 글을 따른다. 링크 페이지와 붙여넣은 글의 발인이 서로 다르면 손님에게 확인을 부탁한다.
//    고인: "故 ○○○"가 있는데 AI 가 다른 이름을 냈으면 확인을 부탁한다(비어 있으면 채운다).
//    장례식장: 우리 장례식장 목록(1,117곳)에서 찾아 주소가 비었으면 채우고, AI 주소와 시·군·구가 다르면 확인을 부탁한다.
//    확인할 칸은 j.check (["발인","고인","장소"]) 로 돌려준다.
const OUT_RE = /발\s*인(?:\s*(?:일시|일자|일|시간|시각))?\s*[:：]?\s*(?:(20\d{2})\s*[년.\-/]\s*)?(\d{1,2})\s*[월.\-/]\s*(\d{1,2})\s*일?\s*(?:\(\s*[월화수목금토일]\s*\)\s*)?(?:(오전|오후|새벽|아침|낮|저녁|밤)\s*)?(?:(\d{1,2})\s*(?:시|:)\s*(?:(\d{1,2})\s*분?)?)?/g;
export function ruleOuts(src, today) {
  const out = [];
  for (const m of String(src || "").matchAll(OUT_RE)) {
    const [, y, mo, d, ap, hh, mi] = m;
    if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31) continue;
    const md = `${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const date = y ? `${y}-${md}` : fixYear(`${Number(today.slice(0, 4)) - 1}-${md}`, "", today);
    let time = "";
    if (hh != null && +hh <= 24) {
      let h = +hh % 24;
      if ((ap === "오후" || ap === "저녁" || ap === "밤") && h < 12) h += 12;
      if (ap === "낮" && h >= 1 && h <= 5) h += 12;
      time = `${String(h).padStart(2, "0")}:${String(Math.min(59, +(mi || 0))).padStart(2, "0")}`;
    }
    if (realDate(date)) out.push({ date, time });
  }
  return out;
}
export function ruleDeceased(src) {
  const m = /故\s*([가-힣]\s?[가-힣]{1,3})/.exec(String(src || ""));
  return m ? m[1].replace(/(님께서|님께|님의|님|께서|씨)$/, "").trim() : "";
}
const areaTokens = (addr) => new Set(
  String(addr || "").replace(/특별자치시|특별자치도|특별시|광역시/g, " ").split(/\s+/)
    .filter((w) => /^[가-힣]{1,6}(시|군|구)$/.test(w)).map((w) => w.replace(/(시|군|구)$/, ""))
);
export function sameArea(a, b) {
  const x = areaTokens(a), y = areaTokens(b);
  if (!x.size || !y.size) return true;
  for (const t of x) if (y.has(t)) return true;
  return false;
}
const homeKey = (s) => String(s || "").replace(/\(.*?\)|주식회사|㈜|\s/g, "");
export function matchHome(name, addr, homes) {
  const k = homeKey(name);
  if (k.length < 3 || !Array.isArray(homes)) return null;
  let c = homes.filter((h) => homeKey(h.n) === k);
  if (!c.length && k.length >= 4) c = homes.filter((h) => { const hk = homeKey(h.n); return hk.length >= 4 && (hk.includes(k) || k.includes(hk)); });
  if (c.length > 1 && addr) c = c.filter((h) => sameArea(addr, h.a));
  return c.length === 1 ? c[0] : null;
}
export function crossCheck(j, src, today, homes) {
  if (!j || typeof j !== "object" || j.type !== "funeral") return j;
  const check = new Set(Array.isArray(j.check) ? j.check : []);
  const outs = ruleOuts(src, today);
  if (outs.length) {
    const r = outs[0];
    if (new Set(outs.map((o) => o.date + (o.time ? " " + o.time : ""))).size > 1 && outs.some((o) => o.date !== r.date || (o.time && r.time && o.time !== r.time))) check.add("발인");
    if (j.date !== r.date) j.date = r.date;
    if (r.time && j.time !== r.time) j.time = r.time;
  }
  const dn = ruleDeceased(src);
  if (dn && !j.recipientName && normName(dn) !== normName(j.chiefMourner)) j.recipientName = dn;
  else if (dn && j.recipientName && normName(dn) !== normName(j.recipientName)) check.add("고인");
  const hit = matchHome(j.venueName, j.venueAddress, homes);
  if (hit) {
    if (!j.venueAddress) j.venueAddress = hit.a;
    else if (!sameArea(j.venueAddress, hit.a)) check.add("장소");
  }
  j.check = [...check];
  return j;
}

// 결혼식 받는 분은 "김현수·김도연" 한 모양으로. AI 가 청첩장 제목대로 "김현수 ♥ 김도연"·"태용♡지윤"·"김태용, 노지윤"을 내던 것을 맞춘다(10/28).
// 이 칸은 사장님 알림·주문서에 그대로 들어가니 하트 같은 꾸밈 글자는 남기지 않는다.
const DECO = /[♥♡❤❣💕💗💖💛💞·,&+/|~\-]|\s그리고\s|\s+/g;
function fixWeddingName(j) {
  if (j.type !== "wedding") return;
  const clean = (v) => String(v || "").replace(/[♥♡❤❣💕💗💖💛💞]/g, "").replace(/\s+/g, " ").trim();
  j.groomName = clean(j.groomName); j.brideName = clean(j.brideName);
  if (j.groomName && j.brideName) { j.recipientName = `${j.groomName}·${j.brideName}`; return; }
  const parts = String(j.recipientName || "").split(DECO).filter(Boolean);
  if (parts.length) j.recipientName = parts.join("·");
}

export function fixParsed(j, src = "", now = Date.now(), homes = null) {
  if (!j || typeof j !== "object") return j;
  const today = kstToday(now);
  if (j.date) j.date = fixYear(j.date, src, today);
  fixWeddingName(j);
  fixMourners(fixNames(j, src));
  return crossCheck(j, src, today, homes);
}
