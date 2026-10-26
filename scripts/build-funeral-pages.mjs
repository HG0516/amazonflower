// scripts/build-funeral-pages.mjs
// 장례식장별 근조화환 페이지(/funeral/<이름>) — '○○장례식장 근조화환'으로 찾는 손님을 바로 주문서로(10/20 형구).
//
// 원본: data/funeral-homes.json (공공데이터 전국 장사시설 현황, scripts/build-funeral-data.py 가 만든다)
// 배송비: regions.js 의 regionCheck 를 그대로 돌려 주문서와 같은 금액을 적는다.
// 정적 파일인 이유: 함수 12개 한도가 꽉 찼고, 검색 로봇은 JS 없이 읽은 HTML 이 가장 확실하다.
//
// 실행: node scripts/build-funeral-pages.mjs  → funeral/*.html, funeral/index.html, sitemap-funeral.xml

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { PRODUCTS } from "../products.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "funeral");
const BASE = (process.env.PUBLIC_BASE_URL || "https://floweranbu.co.kr").replace(/\/+$/, "");
const SRC = JSON.parse(fs.readFileSync(path.join(ROOT, "data/funeral-homes.json"), "utf8"));

const ctx = { globalThis: {} };
ctx.window = ctx.globalThis;
vm.runInNewContext(fs.readFileSync(path.join(ROOT, "regions.js"), "utf8"), ctx);
const regionCheck = ctx.globalThis.regionCheck;

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// '…장례식장으로' · '…병원으로' · '…회관으로' — 받침이 있으면(ㄹ 받침 빼고) '으로'
const ro = (w) => { const c = String(w).trim().slice(-1).charCodeAt(0) - 0xac00; const j = c >= 0 && c < 11172 ? c % 28 : 0; return w + (j && j !== 8 ? "으로" : "로"); };
const won = (n) => n.toLocaleString("ko-KR") + "원";
const SIDO = { 서울특별시: "서울", 부산광역시: "부산", 대구광역시: "대구", 인천광역시: "인천", 광주광역시: "광주", 대전광역시: "대전", 울산광역시: "울산", 세종특별자치시: "세종", 경기도: "경기", 강원도: "강원", 강원특별자치도: "강원", 충청북도: "충북", 충청남도: "충남", 전라북도: "전북", 전북특별자치도: "전북", 전라남도: "전남", 경상북도: "경북", 경상남도: "경남", 제주특별자치도: "제주" };
const sidoOf = (a) => SIDO[String(a).split(/\s+/)[0]] || String(a).split(/\s+/)[0] || "기타";
const guOf = (a) => String(a).split(/\s+/)[1] || "";
// 파일 이름: 장례식장 이름 그대로(검색에 걸리는 말). 같은 이름이 여럿이면 시·군·구를 붙인다.
const slugBase = (n) => String(n).replace(/[\/\\?%*:|"<>#&\s]+/g, "").slice(0, 60);

const wreaths = PRODUCTS.filter((p) => p.cat === "condolence" && p.status !== "품절" && (p.photos || []).length)
  .sort((a, b) => a.price - b.price).slice(0, 4);
const from = wreaths.length ? wreaths[0].price : 49000;
const wreathAll = PRODUCTS.filter((p) => p.cat === "condolence" && p.status !== "품절" && p.price > 0);
const upto = wreathAll.length ? Math.max(...wreathAll.map((p) => p.price)) : from;

const homes = SRC.items.filter((h) => h && h.n && h.a);
const count = {};
homes.forEach((h) => { const s = slugBase(h.n); count[s] = (count[s] || 0) + 1; });
homes.forEach((h) => { const s = slugBase(h.n); h.slug = count[s] > 1 ? s + "-" + slugBase(sidoOf(h.a) + guOf(h.a)) : s; h.sido = sidoOf(h.a); h.gu = guOf(h.a); });
// 시도+구까지 같고 이름도 같은 드문 경우는 번호를 붙인다
const seen = {};
homes.forEach((h) => { if (seen[h.slug]) h.slug += "-" + (++seen[h.slug]); else seen[h.slug] = 1; });

const url = (h) => `${BASE}/funeral/${encodeURIComponent(h.slug)}`;
const orderUrl = (h, tier) => "/?" + new URLSearchParams({ worder: "funeral", v: h.n, a: h.a, from: "funeral-page", ...(tier ? { tier: String(tier) } : {}) }).toString();

const CSS = `:root{--paper:#fff;--bg:#f7f6f2;--ink:#1f1d18;--soft:#5a564d;--faint:#8a857a;--line:#e4e1d8;--accent:#1f4733;--tint:#e8f1ea}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.7 -apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif}
a{color:var(--accent)}.w{max-width:720px;margin:0 auto;padding:20px 16px 48px}
.top{display:flex;justify-content:space-between;align-items:center;font-size:14px}.top a{text-decoration:none;font-weight:700}
h1{margin:18px 0 6px;font-size:25px;line-height:1.35}.lead{margin:0;color:var(--soft)}
.box{margin-top:16px;padding:16px;border:1px solid var(--line);border-radius:14px;background:var(--paper)}
.kv{display:grid;grid-template-columns:72px 1fr;gap:6px 10px;margin:0;font-size:15px}.kv dt{color:var(--faint)}.kv dd{margin:0}
.go{display:block;margin-top:16px;padding:16px;border-radius:14px;background:var(--accent);color:#fff;text-align:center;font-size:17px;font-weight:800;text-decoration:none}
.go small{display:block;font-size:13px;font-weight:600;opacity:.85}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}.grid a{display:block;text-decoration:none;color:var(--ink);border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--paper)}
.grid img{display:block;width:100%;aspect-ratio:1/1;object-fit:cover;background:#eee}.grid span{display:block;padding:8px 10px;font-size:14px}.grid b{display:block;font-size:15px}
h2{margin:26px 0 4px;font-size:18px}ul.q{margin:6px 0 0;padding-left:18px;color:var(--soft)}
.near{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.near a{padding:6px 11px;border:1px solid var(--line);border-radius:999px;background:var(--paper);font-size:14px;text-decoration:none;color:var(--ink)}
.foot{margin-top:30px;font-size:13px;color:var(--faint)}
.bugo{display:block;margin-top:10px;padding:13px 16px;border-radius:14px;background:#26241f;color:#f3f0e8;text-align:center;font-size:15px;font-weight:700;text-decoration:none}`;

function head(title, desc, canon, extra = "") {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canon)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="꽃안부">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${BASE}/photos/products/WC-01_1.jpg">
<meta name="theme-color" content="#1f4733">
<link rel="icon" href="/favicon.ico">
<style>${CSS}</style>${extra}
<script src="/va.js?v=20261025a" defer></script>
</head>`;
}

function page(h, near) {
  const rc = regionCheck(h.a) || null;
  const fee = rc && rc.amt ? `${h.gu || h.sido} 지역은 배송비 ${won(rc.amt)}이 더해져요.` : "배송비가 포함된 가격이에요.";
  const title = `${h.n} 근조화환 ${won(from)}부터 · 당일 배송 | 꽃안부`;
  const desc = `${h.n}(${h.a}) 빈소로 근조화환을 보내요. ${won(from)}부터, ${rc && rc.amt ? "지역 배송비 " + won(rc.amt) : "배송비 포함"}. 평일 18시·주말 16시까지 주문하면 오늘 도착하고, 도착하면 사진으로 알려 드려요.`;
  // AI 검색·검색엔진이 '○○장례식장 근조화환' 질문에 가격·배송 조건을 바로 읽어 가게 서비스 데이터도 붙인다(10/26).
  const ld = { "@context": "https://schema.org", "@graph": [
    { "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "꽃안부", item: BASE + "/" },
      { "@type": "ListItem", position: 2, name: "장례식장 근조화환", item: BASE + "/funeral/" },
      { "@type": "ListItem", position: 3, name: h.n, item: url(h) } ] },
    { "@type": "Service", name: `${h.n} 근조화환 배송`, serviceType: "근조화환 배송", url: url(h),
      description: desc,
      provider: { "@type": "Florist", "@id": BASE + "/#shop", name: "꽃안부", telephone: "+82-1577-2286", url: BASE + "/" },
      areaServed: { "@type": "Place", name: h.n, address: { "@type": "PostalAddress", streetAddress: h.a, addressCountry: "KR" } },
      offers: { "@type": "AggregateOffer", priceCurrency: "KRW", lowPrice: from + (rc && rc.amt ? rc.amt : 0), highPrice: upto + (rc && rc.amt ? rc.amt : 0),
        offerCount: wreathAll.length, url: BASE + orderUrl(h) } } ] };
  return head(title, desc, url(h), `\n<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>`) + `
<body><div class="w">
<div class="top"><a href="/">꽃안부</a><a href="tel:1577-2286">전화 1577-2286</a></div>
<h1>${esc(h.n)}<br>근조화환 보내기</h1>
<p class="lead">빈소 호실과 상주 이름만 적으면 돼요. 장소와 주소는 주문서에 미리 채워 드려요.</p>
<div class="box"><dl class="kv">
<dt>주소</dt><dd>${esc(h.a)}</dd>
${h.t ? `<dt>전화</dt><dd><a href="tel:${esc(String(h.t).replace(/[^0-9]/g, ""))}">${esc(h.t)}</a></dd>` : ""}
${h.r ? `<dt>빈소</dt><dd>${esc(h.r)}개</dd>` : ""}
<dt>배송</dt><dd>평일 18시 · 주말 16시까지 주문하면 오늘 도착해요. ${esc(fee)}</dd>
</dl></div>
<a class="go" href="${esc(orderUrl(h))}">${esc(ro(h.n))} 근조화환 보내기<small>${won(from)}부터 · 도착하면 사진으로 알려 드려요</small></a>
<a class="bugo" href="/bugo/make?${esc(new URLSearchParams({ venue: h.n, ref: "funeral-page" }).toString())}">유족이신가요? ${esc(ro(h.n))} 부고장 무료로 만들기</a>
<h2>근조화환</h2>
<div class="grid">${wreaths.map((p) => `<a href="/catalog.html?item=${encodeURIComponent(p.pc)}"><img src="${esc(p.photos[0])}" alt="${esc(p.name)}" loading="lazy" width="320" height="320"><span><b>${won(p.price)}</b>${esc(p.name)}</span></a>`).join("")}</div>
<h2>자주 묻는 것</h2>
<ul class="q">
<li>빈소 호실을 모르면 비워 두셔도 돼요. 사장님이 장례식장에 확인해서 보내 드려요.</li>
<li>발인이 내일 아침이면 전화(1577-2286)로 주문해 주세요. 시간을 맞춰 바로 보내 드려요.</li>
<li>리본 문구는 주문서에서 고르거나 관계를 적으면 골라 드려요.</li>
</ul>
${near.length ? `<h2>${esc(h.sido)} ${esc(h.gu)} 다른 장례식장</h2><div class="near">${near.map((x) => `<a href="/funeral/${encodeURIComponent(x.slug)}">${esc(x.n)}</a>`).join("")}</div>` : ""}
<p class="foot">장례식장 정보: ${esc(SRC.source)}. 바뀐 내용이 있으면 1577-2286으로 알려 주세요.<br><a href="/funeral/">전국 장례식장 목록</a> · <a href="/bugo">무료 모바일 부고장 만들기</a></p>
</div></body></html>
`;
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const byGu = {};
homes.forEach((h) => { const k = h.sido + " " + h.gu; (byGu[k] = byGu[k] || []).push(h); });
homes.forEach((h) => {
  const near = (byGu[h.sido + " " + h.gu] || []).filter((x) => x !== h).slice(0, 12);
  fs.writeFileSync(path.join(OUT, h.slug + ".html"), page(h, near));
});

// 목록 페이지: 시·도 → 시·군·구 → 장례식장
const order = ["서울", "경기", "인천", "부산", "대구", "광주", "대전", "울산", "세종", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"];
const bySido = {};
homes.forEach((h) => { (bySido[h.sido] = bySido[h.sido] || []).push(h); });
const rank = (s) => { const i = order.indexOf(s); return i < 0 ? 99 : i; };
const sidos = Object.keys(bySido).sort((a, b) => rank(a) - rank(b));
const idx = head("전국 장례식장 근조화환 보내기 | 꽃안부", `전국 장례식장 ${homes.length}곳 어디든 근조화환을 보내요. ${won(from)}부터, 평일 18시·주말 16시까지 주문하면 오늘 도착해요.`, BASE + "/funeral/") + `
<body><div class="w">
<div class="top"><a href="/">꽃안부</a><a href="tel:1577-2286">전화 1577-2286</a></div>
<h1>전국 장례식장 근조화환</h1>
<p class="lead">장례식장을 고르면 주소가 채워진 주문서로 가요. ${won(from)}부터예요.</p>
${sidos.map((s) => `<h2>${esc(s)}</h2><div class="near">${bySido[s].sort((a, b) => (a.gu + a.n).localeCompare(b.gu + b.n, "ko")).map((h) => `<a href="/funeral/${encodeURIComponent(h.slug)}">${esc(h.n)}</a>`).join("")}</div>`).join("\n")}
<p class="foot">장례식장 정보: ${esc(SRC.source)}.</p>
</div></body></html>
`;
fs.writeFileSync(path.join(OUT, "index.html"), idx);

const sm = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${BASE}/funeral/</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>
${homes.map((h) => `  <url><loc>${url(h)}</loc><changefreq>monthly</changefreq><priority>0.5</priority></url>`).join("\n")}
</urlset>
`;
fs.writeFileSync(path.join(ROOT, "sitemap-funeral.xml"), sm);
console.log(`funeral pages: ${homes.length} + index, sitemap-funeral.xml`);
