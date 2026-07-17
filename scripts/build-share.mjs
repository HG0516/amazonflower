// scripts/build-share.mjs
// 상품별 공유 페이지(/s/<pc>.html) 생성 — 카톡·문자로 상품 링크를 보냈을 때
// 그 상품의 사진·이름·가격이 미리보기 카드에 뜨게 하는 유일한 방법.
//
// 왜 정적 파일인가:
//  - Vercel Hobby 서버리스 함수 12개 제한이 이미 꽉 참 → 새 API 추가 불가.
//  - 카톡 크롤러는 JS를 실행하지 않고 응답 HTML의 <meta> 만 읽는다. 콜드스타트 없는 정적이 가장 안전.
//
// 실행: node scripts/build-share.mjs   (build-products.mjs 가 끝에서 자동 호출)
// 산출: s/<pc>.html  (사람은 즉시 카탈로그 상세로 리다이렉트, 크롤러는 meta만 읽고 감)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PRODUCTS } from "../products.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "s");
const BASE = process.env.PUBLIC_BASE_URL || "https://amazonflower.vercel.app";

const CAT_KIND = {
  bouquet: "꽃다발", basket: "꽃바구니", plant: "관엽식물",
  orchid: "난", congrats: "축하화환", condolence: "근조화환",
};

const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function pageHtml(p) {
  const kind = CAT_KIND[p.cat] || "꽃";
  const nm = [p.name, p.subtitle].filter(Boolean).join(" · ");
  const title = `${nm} ${p.price.toLocaleString()}원 — 꽃안부`;
  const desc = `${kind} · 1993년부터 · 전국 당일배송. 부고·청첩장 링크만 붙여넣으면 받는 곳을 알아서 채워드려요.`;
  const img = BASE + (p.photos && p.photos[0] ? p.photos[0] : "/og_preview.png");
  const canonical = `${BASE}/catalog.html?item=${encodeURIComponent(p.pc)}`;
  const share = `${BASE}/s/${encodeURIComponent(p.pc)}`;

  // 사람은 즉시 카탈로그 상세로. 크롤러(JS 미실행)는 meta만 읽고 끝.
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}" />
<link rel="canonical" href="${esc(canonical)}" />
<meta property="og:type" content="product" />
<meta property="og:site_name" content="꽃안부" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(desc)}" />
<meta property="og:image" content="${esc(img)}" />
<meta property="og:url" content="${esc(share)}" />
<meta property="product:price:amount" content="${p.price}" />
<meta property="product:price:currency" content="KRW" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(desc)}" />
<meta name="twitter:image" content="${esc(img)}" />
<meta http-equiv="refresh" content="0; url=${esc(canonical)}" />
<script>
// 유입 꼬리표(?utm_source=insta 등)를 상세 페이지까지 넘긴다 — 안 넘기면 이 링크의 성과가 집계에서 사라진다.
(function(){var q=location.search.slice(1);location.replace(${JSON.stringify(canonical)}+(q?"&"+q:""));})();
</script>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       background:#f6f6f3;color:#1f1d18;font-family:-apple-system,"Apple SD Gothic Neo",sans-serif;
       text-align:center;padding:24px;}
  a{color:#1f4733;font-weight:700;}
</style>
</head>
<body>
  <div>
    <p>${esc(nm)} — ${p.price.toLocaleString()}원</p>
    <p><a href="${esc(canonical)}">꽃안부에서 보기 →</a></p>
  </div>
</body>
</html>
`;
}

export function buildShare() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  // 원장에서 사라진 상품의 공유 페이지는 지운다(가격·이름이 낡은 카드가 떠도는 것 방지)
  const keep = new Set(PRODUCTS.map((p) => `${p.pc}.html`));
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (f.endsWith(".html") && !keep.has(f)) fs.unlinkSync(path.join(OUT_DIR, f));
  }
  for (const p of PRODUCTS) {
    fs.writeFileSync(path.join(OUT_DIR, `${p.pc}.html`), pageHtml(p));
  }
  return PRODUCTS.length;
}

// 경로에 한글이 있으면 import.meta.url 은 퍼센트 인코딩되므로 문자열 비교 대신 pathToFileURL 로 맞춘다.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const n = buildShare();
  console.log(`공유 페이지 ${n}개 생성 → s/*.html  (링크 예: ${BASE}/s/${PRODUCTS[0]?.pc})`);
}
