// scripts/build-products.mjs
// 꽃안부 상품 단일 소스 빌드 — `3.완성` 사진 파일명(이름+가격)을 파싱해 products.js 를 생성한다.
//
// 원칙(기획서 21-G):
//  - 판매가 = 파일명에 적힌 실물 가격 그대로. 이 스크립트가 유일한 상품 원장(products.js)을 만든다.
//  - 상품 ID(pc)는 카테고리 접두어+연번으로 신규 발급하고 ids.json 에 append-only 로 동결한다(재주문/주문이력 파손 방지).
//  - 파싱 이상치(가격 하한/상한, pc 중복, 파싱 실패)는 자동 반영하지 않고 리포트로 출력해 사람이 확인한다.
//
// 실행: node scripts/build-products.mjs   (또는 npm run build-products)
// 산출물: products.js, ids.json(갱신), photo-manifest.json, 콘솔 검증 리포트
// 이미지 실제 복사·리사이즈는 scripts/optimize-photos.py 가 photo-manifest.json 을 읽어 처리한다.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// 완성 사진 원본 위치 (부모님 파이프라인 산출물). 환경변수로 덮어쓸 수 있음.
const SRC =
  process.env.WANSEONG_DIR ||
  "C:\\Users\\COM\\Desktop\\2_꽃사업\\꽃안부_사진작업\\3.완성";

// 폴더 → 카테고리·서브·ID접두어
const FOLDER_MAP = {
  관엽: { cat: "plant", sub: "관엽", prefix: "PL", pad: 3 },
  꽃다발: { cat: "bouquet", sub: "꽃다발", prefix: "BQ", pad: 3 },
  꽃바구니: { cat: "basket", sub: "꽃바구니", prefix: "BS", pad: 3 },
  난_동양란: { cat: "orchid", sub: "동양란", prefix: "OR", pad: 3 },
  난_서양란: { cat: "orchid", sub: "서양란", prefix: "OR", pad: 3 },
  화환_근조: { cat: "condolence", sub: "근조", prefix: "WC", pad: 2, wreath: true },
  화환_축하: { cat: "congrats", sub: "축하", prefix: "WG", pad: 2, wreath: true },
};

// 구 티어 정가표 (api/confirm-payment.js PRODUCT_PRICES 와 동일 — 재주문·구주문 호환용)
const LEGACY_TIERS = {
  congrats_g1: 59000, congrats_g2: 79000, congrats_g3: 99000, congrats_g4: 129000,
  condolence_c1: 59000, condolence_c2: 79000, condolence_c3: 99000, condolence_c4: 129000,
  orchid_o1: 69000, orchid_o2: 99000, orchid_o3: 79000, orchid_o4: 119000,
  plant_p1: 59000, plant_p2: 79000, plant_p3: 99000, plant_p4: 129000,
  basket_b1: 49000, basket_b2: 69000, basket_b3: 59000, basket_b4: 89000,
};

// 토핑 (index.html TOPPINGS + api TOPPING_PRICES 통합 — 단일 소스)
const TOPPINGS = {
  top_rice:   { nm: "쌀 10kg 얹기",        price: 20000, d: "행사 후 상주·혼주께 전달되는 쌀화환 구성" },
  top_ribbon: { nm: "금박 고급 리본",       price: 10000, d: "리본 문구를 금박으로 더 격식 있게" },
  top_pot:    { nm: "도자기 분 업그레이드", price: 20000, d: "기본 분 대신 도자기 화분으로" },
  top_plaque: { nm: "나무 명패",            price: 10000, d: "보내는 분 명패 제작 (법인 인기)" },
  top_more:   { nm: "더 풍성하게",          price: 20000, d: "꽃 물량을 한 단계 늘립니다" },
  top_wine:   { nm: "와인 동봉",            price: 30000, d: "축하 와인 한 병을 함께" },
  top_card:   { nm: "손글씨 카드",          price: 5000,  d: "메시지를 카드에 정성껏 적어 동봉" },
};
const TOPPINGS_BY_CAT = {
  congrats: ["top_rice", "top_ribbon"],
  condolence: ["top_rice", "top_ribbon"],
  orchid: ["top_pot", "top_plaque", "top_ribbon"],
  plant: ["top_pot", "top_plaque"],
  bouquet: ["top_more", "top_wine", "top_card"],
  basket: ["top_more", "top_wine", "top_card"],
};

// 가격 → 금액대 밴드(칩 5만/7만/9만/10만↑, 기획 21-C)
function bandOf(price) {
  if (price < 70000) return "5만대";
  if (price < 90000) return "7만대";
  if (price < 100000) return "9만대";
  return "10만↑";
}

// 카테고리+가격(+서브) → 가장 가까운 구 티어 코드 (재주문 호환용)
function legacyTierOf(cat, sub, price) {
  const tiers = {
    plant: [["plant_p1", 59000], ["plant_p2", 79000], ["plant_p3", 99000], ["plant_p4", 129000]],
    congrats: [["congrats_g1", 59000], ["congrats_g2", 79000], ["congrats_g3", 99000], ["congrats_g4", 129000]],
    condolence: [["condolence_c1", 59000], ["condolence_c2", 79000], ["condolence_c3", 99000], ["condolence_c4", 129000]],
    bouquet: [["basket_b1", 49000], ["basket_b2", 69000]],
    basket: [["basket_b3", 59000], ["basket_b4", 89000]],
    orchid: sub === "서양란"
      ? [["orchid_o3", 79000], ["orchid_o4", 119000]]
      : [["orchid_o1", 69000], ["orchid_o2", 99000]],
  }[cat] || [];
  let best = null, bestD = Infinity;
  for (const [code, p] of tiers) {
    const d = Math.abs(p - price);
    if (d < bestD) { bestD = d; best = code; }
  }
  return best;
}

// 파일명 파서 (화환 외)
// 예) 가지마루NO1_1 가격147,000원사이즈 H900W400.jpg
//     떡갈나무NO1_2 특자가격157,000원.jpg / 녹보수NO1 3지 특자 가격247,000원사이즈 H1,500W700.jpg
const RE_GENERAL =
  /^(.+?)NO(\d+)(?:_(\d+))?\s*(.*?)\s*가격\s*([\d,]+)원(?:\s*사이즈\s*H([\d,]+)W([\d,]+))?\.[^.]+$/;
// 화환: 근조 보통 가격59,000원.jpg / 축하화환 스페셜1호 가격99,000원.jpg
const RE_WREATH = /^(.+?)\s*가격\s*([\d,]+)원\.[^.]+$/;
const num = (s) => (s ? parseInt(String(s).replace(/,/g, ""), 10) : null);

function parseFile(folderInfo, fname) {
  const ext = path.extname(fname).slice(1).toLowerCase();
  if (folderInfo.wreath) {
    const m = fname.match(RE_WREATH);
    if (!m) return { error: "화환 파싱 실패", fname };
    const grade = m[1].trim().replace(/^(근조|축하화환)\s*/, "") || "기본";
    return {
      name: m[1].trim(), grade, group: grade, cut: 1,
      price: num(m[2]), size: null, label: null, ext, fname,
    };
  }
  const m = fname.match(RE_GENERAL);
  if (!m) return { error: "일반 파싱 실패", fname };
  const [, rawName, group, cut, label, price, h, w] = m;
  // 2단 작명 "이름·부제": '·' 앞 = 부르는 이름(상품 정체성 — ID 키에 들어감),
  // '·' 뒤 = 보이는 부제(색·소재 설명 — 바꿔도 ID 안 바뀜). '·' 없으면 부제 없음.
  const dot = rawName.indexOf("·");
  const name = (dot >= 0 ? rawName.slice(0, dot) : rawName).trim();
  const subtitle = dot >= 0 ? rawName.slice(dot + 1).trim() || null : null;
  return {
    name,
    subtitle,
    group: parseInt(group, 10),
    cut: cut ? parseInt(cut, 10) : 1,
    label: (label || "").trim() || null,
    price: num(price),
    size: h && w ? { h: num(h), w: num(w) } : null,
    ext, fname,
  };
}

// ── ids.json 로드 (append-only) ──────────────────────────
const IDS_PATH = path.join(ROOT, "ids.json");
const ids = fs.existsSync(IDS_PATH) ? JSON.parse(fs.readFileSync(IDS_PATH, "utf8")) : {};
const counters = {};
for (const pc of Object.values(ids)) {
  const m = String(pc).match(/^([A-Z]+)-(\d+)$/);
  if (m) counters[m[1]] = Math.max(counters[m[1]] || 0, parseInt(m[2], 10));
}
function assignPc(key, prefix, pad) {
  if (ids[key]) return ids[key];
  counters[prefix] = (counters[prefix] || 0) + 1;
  const pc = `${prefix}-${String(counters[prefix]).padStart(pad, "0")}`;
  ids[key] = pc;
  return pc;
}

// ── 수집 ─────────────────────────────────────────────────
if (!fs.existsSync(SRC)) {
  console.error(`[중단] 완성 폴더 없음: ${SRC}\n  WANSEONG_DIR 환경변수로 경로를 지정하세요.`);
  process.exit(1);
}

const report = { parseFail: [], priceOut: [], dupCut: [], notes: [] };
const productMap = new Map(); // productKey -> product

for (const [folder, info] of Object.entries(FOLDER_MAP)) {
  const dir = path.join(SRC, folder);
  if (!fs.existsSync(dir)) { report.notes.push(`폴더 없음: ${folder}`); continue; }
  const files = fs.readdirSync(dir)
    .filter((f) => /\.(jpe?g|png)$/i.test(f))
    .sort();
  for (const fname of files) {
    const p = parseFile(info, fname);
    if (p.error) { report.parseFail.push(`${folder}/${fname} — ${p.error}`); continue; }
    if (p.price == null || p.price < 30000 || p.price > 300000) {
      report.priceOut.push(`${folder}/${fname} — 가격 ${p.price}`);
      continue; // 이상치 자동 반영 금지
    }
    // 상품 키: 카테고리+이름+그룹 (화환은 카테고리+등급)
    const productKey = info.wreath
      ? `${info.cat}|${p.grade}`
      : `${info.cat}|${info.sub}|${p.name}|${p.group}`;
    const pc = assignPc(productKey, info.prefix, info.pad);
    let prod = productMap.get(pc);
    if (!prod) {
      prod = {
        pc,
        cat: info.cat,
        sub: info.sub,
        name: info.wreath ? `${info.sub} ${p.grade}` : p.name,
        subtitle: info.wreath ? null : p.subtitle || null,
        price: p.price,
        band: bandOf(p.price),
        grade: p.label || (info.wreath ? p.grade : null),
        size: null,
        status: "판매중",
        legacyTier: legacyTierOf(info.cat, info.sub, p.price),
        _cuts: [],
      };
      productMap.set(pc, prod);
    }
    // 같은 상품인데 가격이 다르면 경고 (그룹 규칙 위반 가능)
    if (prod.price !== p.price) {
      report.dupCut.push(`${pc} 가격 불일치: ${prod.price} vs ${p.price} (${fname})`);
    }
    if (p.size && !prod.size) prod.size = p.size; // _1 컷 사이즈 채택
    prod._cuts.push({ cut: p.cut, src: path.join(dir, fname), ext: p.ext });
  }
}

// ── 컷 정렬 + 사진 경로 확정 + 매니페스트 ────────────────
const manifest = [];
const products = [];
for (const prod of productMap.values()) {
  prod._cuts.sort((a, b) => a.cut - b.cut);
  prod.photos = prod._cuts.map((c, i) => {
    const dest = `photos/products/${prod.pc}_${i + 1}.jpg`;
    manifest.push({ src: c.src, dest });
    return "/" + dest;
  });
  delete prod._cuts;
  products.push(prod);
}
// pc 순 정렬(카테고리 접두어 → 연번)
products.sort((a, b) => a.pc.localeCompare(b.pc, "en", { numeric: true }));

// ── products.js(브라우저 classic) + products.mjs(서버 ESM) 이중 생성 ──
// 브라우저 classic <script src> 는 export 키워드를 못 읽고, Vercel 서버리스(type:module)는 import 가 필요.
// → 같은 빌드에서 두 파일을 함께 뽑아 단일 소스를 유지한다(둘 다 자동 생성물, 손대지 말 것).
const banner = (f, other) => `// ${f} — 꽃안부 상품 단일 소스 (자동 생성물, 직접 수정 금지)
// 생성: scripts/build-products.mjs  |  원장: 3.완성 사진 파일명(이름+가격)  |  짝: ${other}
// 프론트(catalog.html·index.html)는 products.js, 결제검증 서버(api/confirm-payment.js)는 products.mjs 를 읽는다.
// ⚠️ public 레포이므로 원가·마진 등 내부 정보 필드 금지. 판매가·공개 스펙만.\n`;
const dataDefs =
  `const PRODUCTS = ${JSON.stringify(products, null, 1)};\n\n` +
  `const LEGACY_TIERS = ${JSON.stringify(LEGACY_TIERS, null, 1)};\n\n` +
  `const TOPPINGS = ${JSON.stringify(TOPPINGS, null, 1)};\n\n` +
  `const TOPPINGS_BY_CAT = ${JSON.stringify(TOPPINGS_BY_CAT, null, 1)};\n\n` +
  `// 상품코드(신규 pc 또는 구 티어코드) → 정가. 결제 금액검증의 단일 기준.\n` +
  `function priceOf(code){\n` +
  `  const p = PRODUCTS.find((x) => x.pc === code);\n` +
  `  if (p) return p.price;\n` +
  `  if (code in LEGACY_TIERS) return LEGACY_TIERS[code];\n` +
  `  return null;\n}\n\n` +
  `const AF_PRODUCTS = { PRODUCTS, LEGACY_TIERS, TOPPINGS, TOPPINGS_BY_CAT, priceOf };\n`;
// 브라우저용: IIFE로 감싸 전역 렉시컬 오염 방지(다른 classic script의 const TOPPINGS 등과 재선언 충돌 회피),
// window 에만 노출. export 없음.
const classicJs =
  banner("products.js", "products.mjs") +
  `(function () {\n` +
  dataDefs +
  `  if (typeof window !== "undefined") { Object.assign(window, AF_PRODUCTS); window.AF_PRODUCTS = AF_PRODUCTS; }\n` +
  `})();\n`;
// 서버용(ESM): export
const esmJs =
  banner("products.mjs", "products.js") + dataDefs +
  `export { PRODUCTS, LEGACY_TIERS, TOPPINGS, TOPPINGS_BY_CAT, priceOf };\n` +
  `export default AF_PRODUCTS;\n`;
fs.writeFileSync(path.join(ROOT, "products.js"), classicJs, "utf8");
fs.writeFileSync(path.join(ROOT, "products.mjs"), esmJs, "utf8");
fs.writeFileSync(IDS_PATH, JSON.stringify(ids, null, 1), "utf8");
fs.writeFileSync(path.join(ROOT, "photo-manifest.json"), JSON.stringify(manifest, null, 1), "utf8");

// ── 리포트 ───────────────────────────────────────────────
const byCat = {};
for (const p of products) {
  byCat[p.cat] = byCat[p.cat] || { n: 0, cuts: 0, lo: Infinity, hi: 0 };
  byCat[p.cat].n++; byCat[p.cat].cuts += p.photos.length;
  byCat[p.cat].lo = Math.min(byCat[p.cat].lo, p.price);
  byCat[p.cat].hi = Math.max(byCat[p.cat].hi, p.price);
}
console.log("═══ products.js 빌드 완료 ═══");
console.log(`상품 ${products.length}종 / 컷 ${manifest.length}장 / pc 총 ${Object.keys(ids).length}개(ids.json)`);
for (const [cat, s] of Object.entries(byCat)) {
  console.log(`  ${cat.padEnd(10)} 상품 ${String(s.n).padStart(2)}종 / ${String(s.cuts).padStart(3)}컷 / ${s.lo / 1000}~${s.hi / 1000}천원`);
}
console.log("\n── 검증(사람 확인 필요) ──");
const dump = (title, arr) => { console.log(`[${title}] ${arr.length}건`); arr.forEach((x) => console.log("   " + x)); };
dump("파싱 실패", report.parseFail);
dump("가격 이상치(3만 미만·30만 초과, 제외됨)", report.priceOut);
dump("그룹 내 가격 불일치", report.dupCut);
if (report.notes.length) dump("참고", report.notes);
console.log(`\n산출: products.js / ids.json / photo-manifest.json`);
console.log(`다음: python scripts/optimize-photos.py  (사진 ${manifest.length}장 → photos/products/)`);
