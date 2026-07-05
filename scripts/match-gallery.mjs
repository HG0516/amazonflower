// 갤러리 사진 ↔ 판매상품(products.js) 자동 매칭 — 프롬프트 11.
// 원칙: 같은 카테고리 안에서 이름이 확실히 겹치는 "단 1개" 상품일 때만 pc 부여.
//       애매(0개 또는 2개 이상, 같은 이름 가격만 다름)하면 null — 검수표로 사람이 판단.
// 실행: node scripts/match-gallery.mjs        (검수표 출력 + gallery-data.js 갱신)
import { readFileSync, writeFileSync } from "node:fs";
import { PRODUCTS } from "../products.mjs";

const GPATH = new URL("../gallery-data.js", import.meta.url);
const src = readFileSync(GPATH, "utf8");
const jsonText = src.slice(src.indexOf("{", src.indexOf("window.GALLERY")), src.lastIndexOf("}") + 1);
const GALLERY = JSON.parse(jsonText);

const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, "");
// 갤러리 표기 ↔ 상품명 표기가 다른 알려진 동의어(확실한 것만)
const ALIAS = { "파치라": "파키라", "벤자민": "벤자민고무나무", "zz플랜트": "금전수", "zz식물": "금전수", "자미오쿨카스": "금전수" };
const gname = (nm) => { const n = norm(nm); return ALIAS[n] || n; };

const rows = [];
for (const [cat, items] of Object.entries(GALLERY)) {
  for (const it of items) {
    const g = gname(it.nm);
    const hits = PRODUCTS.filter((p) => p.cat === cat && (norm(p.name) === g || g.includes(norm(p.name)) || norm(p.name).includes(g)));
    const uniqNames = [...new Set(hits.map((h) => h.name))];
    let pc = null, why;
    if (hits.length === 1) { pc = hits[0].pc; why = "단일 일치"; }
    else if (hits.length === 0) { why = "일치 상품 없음"; }
    else if (uniqNames.length === 1) { why = `같은 이름 ${hits.length}개(가격만 다름) — 사진으로 판단 필요`; }
    else { why = `후보 ${hits.length}개(${uniqNames.join(",")})`; }
    it.pc = pc;
    rows.push({ cat, f: it.f.split("/").pop(), nm: it.nm, pc, hit: pc ? `${hits[0].name} ${hits[0].price.toLocaleString()}원` : "", why });
  }
}

const head = `// 갤러리 데이터 — 사진 추가 시 여기에 한 줄씩 추가하면 됩니다.
// { f:사진경로, nm:표시이름, sub:소분류, color:색, pc:판매상품코드(있으면 클릭 시 바로 주문, 모르면 null) }
// pc 는 scripts/match-gallery.mjs 가 자동 채움(확실할 때만) — 직접 적어도 됨.
window.GALLERY = `;
writeFileSync(GPATH, head + JSON.stringify(GALLERY, null, 2) + ";\n", "utf8");

const matched = rows.filter((r) => r.pc);
console.log(`총 ${rows.length}장 중 자동매칭 ${matched.length}장 (나머지는 null → 기존 동작 유지)`);
console.log("\n== 매칭됨 ==");
for (const r of matched) console.log(`${r.cat} | ${r.nm} → ${r.pc} (${r.hit})`);
console.log("\n== 미매칭 사유 요약 ==");
const byWhy = {};
for (const r of rows.filter((r) => !r.pc)) (byWhy[`${r.cat}|${r.why}`] = byWhy[`${r.cat}|${r.why}`] || []).push(r.nm);
for (const [k, v] of Object.entries(byWhy)) console.log(`${k}: ${v.length}장 (${[...new Set(v)].slice(0, 6).join(", ")}${new Set(v).size > 6 ? " 외" : ""})`);
