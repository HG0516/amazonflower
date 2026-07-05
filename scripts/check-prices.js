// scripts/check-prices.js
// 가격 3곳 동기화 검증 — api/confirm-payment.js(서버 기준) vs catalog.html(TIERS) vs index.html(CATALOG/WREATH_TIERS).
// catalog/index 에 노출된 상품의 가격이 서버 정가와 다르면 실패(exit 1)한다.
// (서버에만 있는 단종 SKU congrats_g2/condolence_c2 는 노출 안 되므로 검사 대상 아님)
//
// 실행: npm run check-prices   (push 전에 한 번)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LEGACY_TIERS } from "../products.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

// catalog 의 code(AF-X0N) → 서버 productCode(category_xN)
function afToPc(af) {
  const m = af.match(/^AF-([CGOPB])0?(\d)$/i);
  if (!m) return null;
  const map = { C: "condolence_c", G: "congrats_g", O: "orchid_o", P: "plant_p", B: "basket_b" };
  return map[m[1].toUpperCase()] + m[2];
}

// 1) 단일 소스 기준 = products.mjs 의 LEGACY_TIERS (구 티어코드 정가).
//    confirm-payment.js 는 priceOf() 로 이 값을 읽으므로, 화면(catalog/index)에 노출된
//    티어 가격이 이 기준과 어긋나면 결제 검증과 불일치 → 실패.
function parseServer() {
  return { ...LEGACY_TIERS };
}
// 2) catalog TIERS: price + code
function parseCatalog() {
  const t = read("catalog.html");
  const out = {};
  const re = /price:\s*(\d+)[^}]*?code:\s*"(AF-[A-Z]\d+)"/g; let m;
  while ((m = re.exec(t))) { const pc = afToPc(m[2]); if (pc) out[pc] = +m[1]; }
  return out;
}
// 3) index: WREATH_TIERS(key→g/c) + CATALOG items(price,pc)
function parseIndex() {
  const t = read("index.html");
  const out = {};
  const wt = t.slice(t.indexOf("WREATH_TIERS"), t.indexOf("const CATALOG"));
  let m;
  const re1 = /key:\s*"(\d)",\s*grade:"[^"]*",\s*price:\s*(\d+)/g;
  while ((m = re1.exec(wt))) { out["congrats_g" + m[1]] = +m[2]; out["condolence_c" + m[1]] = +m[2]; }
  const re2 = /price:\s*(\d+),\s*pc:\s*"([a-z]+_[a-z]\d)"/g;
  while ((m = re2.exec(t))) out[m[2]] = +m[1];
  return out;
}

const server = parseServer();
const sources = { catalog: parseCatalog(), index: parseIndex() };
const errors = [];

for (const [name, map] of Object.entries(sources)) {
  const keys = Object.keys(map);
  if (keys.length === 0) errors.push(`${name}: 가격을 하나도 못 읽음(파서 점검 필요)`);
  for (const pc of keys) {
    if (server[pc] == null) errors.push(`${name}: '${pc}' 가 products.mjs LEGACY_TIERS 에 없음`);
    else if (server[pc] !== map[pc]) errors.push(`${name}: '${pc}' 가격 불일치 — ${name}=${map[pc]} vs 단일소스=${server[pc]}`);
  }
}

if (errors.length) {
  console.error("❌ 가격 불일치:\n  " + errors.join("\n  "));
  process.exit(1);
}
console.log(`✅ 가격 3곳 일치 (server ${Object.keys(server).length} / catalog ${Object.keys(sources.catalog).length} / index ${Object.keys(sources.index).length})`);
