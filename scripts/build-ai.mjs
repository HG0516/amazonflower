// scripts/build-ai.mjs
// AI 검색·AI 비서가 읽어 가는 파일(10/26 형구: "챗GPT나 클로드가 크롤링하면 먼저 노출되게").
//   prices.html   전체 상품 가격표 (/prices). catalog.html 은 JS 로 상품을 그려서 AI 로봇(JS 미실행)에겐 빈 화면이다.
//   faq.html      자주 묻는 것 (/faq). FAQPage 데이터 포함.
//   llms.txt      AI 가 먼저 읽는 안내 한 장. 주문 링크 만드는 법까지.
//   llms-full.txt 위 내용 + 전 상품 + 자주 묻는 것 + 추가 배송비 지역.
//
// 가격·이름은 products.mjs, 추가 배송비는 regions.js 에서 읽는다. 손으로 고치지 말고 다시 돌릴 것.
// 실행: node scripts/build-ai.mjs   (build-products.mjs 가 끝에서 자동 호출)

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PRODUCTS } from "../products.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.PUBLIC_BASE_URL || "https://floweranbu.co.kr").replace(/\/+$/, "");

const ctx = { globalThis: {} };
ctx.window = ctx.globalThis;
vm.runInNewContext(fs.readFileSync(path.join(ROOT, "regions.js"), "utf8"), ctx);
const REGION = ctx.globalThis.REGION_DATA;

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const won = (n) => n.toLocaleString("ko-KR") + "원";
const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, "\\u003c")}</script>`;

// 사업자 정보: footer.js 의 BIZ 와 같은 값(전자상거래법 표시). 바뀌면 둘 다 고칠 것.
export const SHOP = {
  name: "꽃안부", company: "주식회사 아마존", owner: "권점숙", bizNo: "234-86-00344",
  mailOrderNo: "제2026-경기시흥-1357호", addr: "경기 시흥시 신천3길 23, 103호", tel: "1577-2286", email: "amazonflower@naver.com",
  insta: "https://instagram.com/floweranbu_", kakao: "https://pf.kakao.com/_AXXBX",
};
const SHOP_ID = BASE + "/#shop";

export const CATS = [
  ["condolence", "근조화환", "장례식장 빈소로 보내는 화환이에요. 리본에 보내는 분 이름과 문구를 적어 드려요."],
  ["congrats", "축하화환", "결혼식장이나 개업한 곳으로 보내는 화환이에요. 쌀화환도 있어요."],
  ["bouquet", "꽃다발", "생일이나 기념일에 손에 들려 드리기 좋아요."],
  ["basket", "꽃바구니", "받는 분이 꽃병을 따로 준비하지 않아도 돼요."],
  ["orchid", "난", "승진이나 취임을 축하할 때 많이 보내요."],
  ["plant", "관엽식물", "개업이나 이전을 축하할 때 많이 보내요."],
];

const onSale = PRODUCTS.filter((p) => p.status !== "품절" && p.price > 0);
const byCat = (c) => onSale.filter((p) => p.cat === c).sort((a, b) => a.price - b.price || a.pc.localeCompare(b.pc));
const range = (c) => { const l = byCat(c); return l.length ? [l[0].price, l[l.length - 1].price] : null; };
export function itemName(p) {
  let n = p.subtitle ? `${p.name} (${p.subtitle})` : p.name;
  if (p.cat === "orchid" && p.sub) n += ` · ${p.sub}`;
  if (p.cat === "plant" && p.size && p.size.h) n += ` · 높이 약 ${Math.round(p.size.h / 10)}cm`;
  return n;
}
const wreathFrom = range("condolence") ? range("condolence")[0] : 49000;

// 주문서 규칙과 같은 말만 쓴다(마감 afCutoffHour, 배송비 regions.js, 환불 terms.html 제7조).
export const FAQ = [
  ["오늘 받을 수 있나요?", "평일 18시, 주말 16시까지 주문하면 오늘 도착해요. 그보다 늦으면 다음 날 보내 드려요. 급하면 1577-2286으로 전화 주세요."],
  ["배송비가 따로 있나요?", "상품 가격에 기본 배송비가 들어 있어요. 거리가 먼 일부 지역은 1만 원에서 3만 원이 더해지고, 주소를 넣으면 주문서가 바로 계산해 드려요."],
  ["전국 어디든 보내 주나요?", "전국으로 보내요. 일부 섬과 외진 곳은 배송이 어려워서, 주소를 넣으면 주문서가 먼저 알려 드려요."],
  ["장례식장 빈소 호실을 몰라도 되나요?", "비워 두셔도 돼요. 사장님이 장례식장에 확인해서 보내 드려요."],
  ["부고장이나 청첩장 링크만 있는데 주문할 수 있나요?", "링크나 캡처 사진을 첫 화면 칸에 넣으면 내용을 읽어 주문서를 채워 드려요. 부고장은 고인 성함, 장례식장, 발인 시간을 읽고 청첩장은 두 분 이름, 예식장, 예식 시간을 읽어요. 채워진 내용을 한 번 보고 결제하시면 돼요."],
  ["발인이 내일 아침이에요.", "전화(1577-2286)로 주문해 주세요. 발인 전에 닿도록 바로 보내 드려요."],
  ["리본 문구는 어떻게 정하나요?", "주문서에서 고르거나, 받는 분과의 관계를 적으면 맞는 문구를 골라 드려요. 보내는 분 이름도 리본에 들어가요."],
  ["도착했는지 알 수 있나요?", "배송하고 바로 도착 사진을 문자로 보내 드려요."],
  ["결제는 어떻게 하나요?", "카드, 네이버페이, 카카오페이, 토스페이로 결제할 수 있어요. 회원가입 없이 주문할 수 있고 전화 주문도 받아요."],
  ["회사 이름으로 보내고 계산서를 받을 수 있나요?", "주문서에서 법인·단체를 펼쳐 사업자 정보를 넣으면 계산서를 발행해 드려요. 자주 보내는 회사는 후불과 월 정산 거래처로 등록할 수 있어요(1577-2286)."],
  ["주문을 취소하거나 환불할 수 있나요?", "배송을 시작하기 전이면 주문을 취소하고 전액 환불받을 수 있어요. 꽃은 주문을 받고 만드는 상품이라 만들기 시작했거나 보낸 뒤에는 단순 변심으로 인한 환불이 제한될 수 있어요. 상품에 문제가 있거나 잘못 배송됐다면 받은 직후 사진과 함께 연락 주세요. 다시 만들어 보내거나 환불해 드려요."],
  ["사진과 똑같이 오나요?", "계절과 꽃 수급에 따라 사진과 조금 다를 수 있어요. 그럴 때는 같은 등급 이상으로 만들어 드려요."],
  ["무료 부고장은 어떻게 만드나요?", "고인 성함, 상주, 장례식장을 적으면 돼요(https://floweranbu.co.kr/bugo). 장례식장은 이름만 치면 주소와 전화가 채워지고 빈소, 발인, 계좌, 지도가 한 장에 담겨요. 카톡이나 문자로 보내면 받는 분은 앱 없이 바로 봐요. 회원가입과 광고는 없어요."],
  ["부고장을 보낸 뒤 발인 시간이 바뀌었어요.", "만들 때 받은 고칠 때 쓰는 링크로 열어 바꾸면, 이미 보낸 링크에도 바뀐 내용이 보여요. 다시 보낼 필요가 없어요. 부고장과 조문 글은 발인 7일 뒤 자동으로 지워져요."],
  ["무료 모바일 청첩장도 있나요?", "있어요(https://floweranbu.co.kr/wedding-card). 디자인을 고르고 사진을 8장까지 넣을 수 있어요. 계좌는 신랑 측과 신부 측을 나눠 넣고 카카오페이 송금 링크도 달 수 있어요. 예식 30일 뒤 자동으로 지워져요."],
  ["부고장과 청첩장이 왜 무료인가요?", "안에 화환 보내기 칸이 하나 있어요. 직접 가기 어려운 분이 그 칸으로 화환을 보내면 그 주문이 꽃안부의 일이에요. 그 칸은 유족이나 두 분이 끌 수 있고, 광고나 팝업은 넣지 않아요."],
  ["신부 부케도 하나요?", "토요일과 일요일에 각 1~2건만 받는 예약제로 만들어요. 본식 부케는 16만~22만 원이에요(https://floweranbu.co.kr/wedding.html)."],
  ["어떤 가게인가요?", "경기 시흥에서 1993년부터 같은 사장님이 운영하는 꽃집이에요. 상호는 주식회사 아마존이고 대표 전화는 1577-2286이에요."],
];

const CSS = `:root{--paper:#fff;--bg:#f7f6f2;--ink:#1f1d18;--soft:#5a564d;--faint:#8a857a;--line:#e4e1d8;--accent:#1f4733}
@media (prefers-color-scheme:dark){:root{--paper:#202124;--bg:#17181a;--ink:#eceae4;--soft:#c4c0b6;--faint:#a5a197;--line:#2c2d30;--accent:#7fc29b}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.7 -apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;word-break:keep-all;overflow-wrap:anywhere}
a{color:var(--accent)}.w{max-width:720px;margin:0 auto;padding:20px 16px 48px}
.top{display:flex;justify-content:space-between;align-items:center;font-size:14px}.top a{text-decoration:none;font-weight:700}
h1{margin:18px 0 6px;font-size:25px;line-height:1.35}.lead{margin:0;color:var(--soft)}
.box{margin-top:16px;padding:16px;border:1px solid var(--line);border-radius:14px;background:var(--paper)}
.kv{display:grid;grid-template-columns:76px 1fr;gap:6px 10px;margin:0;font-size:15px}.kv dt{color:var(--faint)}.kv dd{margin:0}
.jump{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px}.jump a{padding:6px 11px;border:1px solid var(--line);border-radius:999px;background:var(--paper);font-size:14px;text-decoration:none;color:var(--ink)}
h2{margin:28px 0 2px;font-size:19px}.cd{margin:0 0 8px;color:var(--soft);font-size:14px}
ul.it{list-style:none;margin:0;padding:0;border-top:1px solid var(--line)}
ul.it li{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)}
ul.it img{width:64px;height:64px;border-radius:10px;object-fit:cover;background:#eee;flex:0 0 auto;display:block}
ul.it .nm{flex:1;min-width:0}ul.it .nm b{display:block;font-size:15px;font-weight:600}ul.it .nm span{font-size:16px;font-weight:800}
ul.it .buy{flex:0 0 auto;padding:9px 14px;border-radius:10px;background:var(--accent);color:#fff;font-size:14px;font-weight:700;text-decoration:none}
.qa{margin-top:10px}.qa h2{font-size:17px;margin:22px 0 4px}.qa p{margin:0;color:var(--soft)}
.go{display:block;margin-top:22px;padding:15px;border-radius:14px;background:var(--accent);color:#fff;text-align:center;font-size:16px;font-weight:800;text-decoration:none}
.foot{margin-top:30px;font-size:13px;color:var(--faint)}.nw{white-space:nowrap}`;

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
<meta property="og:url" content="${esc(canon)}">
<meta property="og:image" content="${BASE}/og_preview.png">
<meta name="theme-color" content="#1f4733">
<link rel="icon" href="/favicon.ico">
<style>${CSS}</style>
${extra}
<script src="/va.js?v=20261025a" defer></script>
</head>`;
}

const topBar = `<div class="top"><a href="/">꽃안부</a><a href="tel:1577-2286">전화 1577-2286</a></div>`;
const bizLine = `${SHOP.name} · ${SHOP.company} · 대표 ${SHOP.owner} · 사업자등록번호 ${SHOP.bizNo} · 통신판매업 ${SHOP.mailOrderNo} · ${SHOP.addr} · ${SHOP.tel} · ${SHOP.email}`;
const footHtml = (more) => `<p class="foot">${more}<br>${esc(bizLine)}</p>`;
const factsBox = `<div class="box"><dl class="kv">
<dt>주문 마감</dt><dd>평일 18시, 주말 16시까지 주문하면 오늘 도착해요.</dd>
<dt>배송비</dt><dd>가격에 기본 배송비가 들어 있어요. 거리가 먼 일부 지역은 1만~3만 원이 더해져요.</dd>
<dt>도착 확인</dt><dd>배송하고 바로 도착 사진을 문자로 보내 드려요.</dd>
<dt>결제</dt><dd>카드, 네이버페이, 카카오페이, 토스페이. 회원가입 없이 주문할 수 있어요.</dd>
<dt>전화</dt><dd><a href="tel:15772286">1577-2286</a></dd>
</dl></div>`;

export function pricesHtml() {
  const total = onSale.length;
  const title = `꽃안부 전체 상품 가격 | 근조화환 ${won(wreathFrom)}부터`;
  const desc = `근조화환, 축하화환, 꽃다발, 꽃바구니, 난, 관엽식물 ${total}가지의 가격이에요. 기본 배송비 포함, 평일 18시·주말 16시까지 주문하면 오늘 도착해요.`;
  let pos = 0;
  const list = {
    "@context": "https://schema.org", "@type": "ItemList", name: "꽃안부 전체 상품", numberOfItems: total,
    itemListElement: CATS.flatMap(([c, label]) => byCat(c).map((p) => ({
      "@type": "ListItem", position: ++pos,
      item: {
        "@type": "Product", name: itemName(p), sku: p.pc, category: label,
        image: p.photos && p.photos[0] ? BASE + p.photos[0] : undefined,
        url: `${BASE}/prices#${p.pc}`, brand: { "@type": "Brand", name: "꽃안부" },
        offers: { "@type": "Offer", price: p.price, priceCurrency: "KRW", availability: "https://schema.org/InStock",
          url: `${BASE}/?pc=${encodeURIComponent(p.pc)}`, seller: { "@type": "Florist", "@id": SHOP_ID, name: SHOP.name } },
      },
    }))),
  };
  const crumb = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: "꽃안부", item: BASE + "/" },
    { "@type": "ListItem", position: 2, name: "전체 상품 가격", item: BASE + "/prices" } ] };
  const sections = CATS.map(([c, label, d]) => {
    const l = byCat(c); if (!l.length) return "";
    return `<h2 id="${c}">${esc(label)} ${won(l[0].price)}부터</h2><p class="cd">${esc(d)}</p>
<ul class="it">${l.map((p) => `<li id="${esc(p.pc)}">${p.photos && p.photos[0] ? `<a href="/catalog.html?item=${encodeURIComponent(p.pc)}"><img src="${esc(p.photos[0])}" alt="${esc(itemName(p))}" loading="lazy" width="64" height="64"></a>` : ""}<div class="nm"><b>${esc(itemName(p))}</b><span>${won(p.price)}</span></div><a class="buy" href="/?pc=${encodeURIComponent(p.pc)}">주문</a></li>`).join("")}</ul>`;
  }).join("\n");
  return head(title, desc, BASE + "/prices", ld(list) + "\n" + ld(crumb)) + `
<body><div class="w">
${topBar}
<h1>전체 상품 가격</h1>
<p class="lead">꽃안부에서 파는 상품 ${total}가지예요. 사진을 누르면 크게 보이고, 주문을 누르면 그 상품으로 주문서가 열려요.</p>
${factsBox}
<div class="jump">${CATS.map(([c, label]) => byCat(c).length ? `<a href="#${c}">${esc(label)}</a>` : "").join("")}</div>
${sections}
<a class="go" href="/faq">자주 묻는 것 보기</a>
${footHtml(`<a href="/catalog.html">사진으로 고르기</a> · <a href="/funeral/">전국 장례식장 근조화환</a> · <a href="/bugo">무료 부고장</a>`)}
</div></body></html>
`;
}

export function faqHtml() {
  const title = "자주 묻는 것 | 꽃안부 꽃·화환 주문";
  const desc = "오늘 도착 마감, 배송비, 빈소 호실, 리본 문구, 계산서, 취소와 환불까지 꽃안부 주문 전에 많이 묻는 것을 모았어요.";
  const faq = { "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: FAQ.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) };
  const link = (t) => esc(t).replace(/https:\/\/floweranbu\.co\.kr(\/[\w.\-/]*)?/g, (u) => `<a href="${u}">${u}</a>`)
    .replace(/1577-2286/g, '<a class="nw" href="tel:15772286">1577-2286</a>');
  return head(title, desc, BASE + "/faq", ld(faq)) + `
<body><div class="w">
${topBar}
<h1>자주 묻는 것</h1>
<p class="lead">더 궁금한 건 1577-2286으로 전화 주세요.</p>
<div class="qa">${FAQ.map(([q, a]) => `<h2>${esc(q)}</h2><p>${link(a)}</p>`).join("\n")}</div>
<a class="go" href="/prices">전체 상품 가격 보기</a>
${footHtml(`<a href="/">처음으로</a> · <a href="/funeral/">전국 장례식장 근조화환</a> · <a href="/terms.html">이용약관</a>`)}
</div></body></html>
`;
}

const rangeLine = ([c, label]) => { const r = range(c); return r ? `- ${label}: ${won(r[0])}~${won(r[1])} (${byCat(c).length}가지)` : ""; };

const ORDER_LINKS = `## AI 비서가 주문 링크를 만들 때

손님 대신 결제할 수는 없어요. 아래 링크를 만들어 건네면 받는 곳이 채워진 주문서가 열리고, 손님이 상품과 보내는 분을 고른 뒤 직접 결제해요. 값은 URL 인코딩하고, 모르는 값은 빼요.

- 근조화환(장례식장): ${BASE}/?worder=funeral&v={장례식장 이름}&a={주소}&rn={고인 성함}&cm={상주}&vd={빈소 호실}&utm_source=ai
  - v 와 a 중 하나는 있어야 해요. 고인 성함에 '故'는 붙이지 않아요.
  - 받는 날은 오늘로 잡혀요. 마감(평일 18시, 주말 16시)이 지났으면 내일이에요.
- 축하화환(결혼식): ${BASE}/?worder=wedding&v={예식장}&a={주소}&d={예식 날짜 YYYY-MM-DD}&et={예식 시각 HH:MM}&gn={신랑}&bn={신부}&vd={홀}&utm_source=ai
  - 예식 1시간 전에 도착하도록 잡혀요.
- 상품 하나를 골라 주문: ${BASE}/?pc={상품 코드}&utm_source=ai
  - 상품 코드는 ${BASE}/prices 와 ${BASE}/llms-full.txt 에 있어요. 예: 근조화환 ${won(wreathFrom)}짜리는 ${byCat("condolence")[0]?.pc || "WC-01"}.
- 장례식장마다 안내 페이지가 있어요: ${BASE}/funeral/{장례식장 이름} (목록 ${BASE}/funeral/)
- 부고장 링크나 캡처만 있으면 ${BASE}/ 첫 화면 칸에 붙여 넣게 안내해 주세요. 고인, 장례식장, 발인을 읽어 주문서를 채워요.`;

export function llmsTxt() {
  return `# 꽃안부

> 경기 시흥에서 1993년부터 같은 사장님이 운영하는 꽃집의 온라인 주문 사이트예요. 근조화환, 축하화환, 꽃다발, 꽃바구니, 난, 관엽식물을 전국 당일 배송해요.
> Floweranbu (꽃안부) is a Korean florist (since 1993, Siheung, Gyeonggi) offering nationwide same-day delivery of funeral wreaths, congratulatory wreaths, bouquets, orchids and plants. Order online without sign-up, or call +82-1577-2286.

## 핵심
- 주문 마감: 평일 18시, 주말 16시까지 주문하면 오늘 도착
- 배송: 전국. 가격에 기본 배송비 포함, 먼 일부 지역은 1만~3만 원 추가(주문서가 주소로 자동 계산)
- 도착 사진을 문자로 보내 줌
- 결제: 카드, 네이버페이, 카카오페이, 토스페이. 회원가입 없이 주문. 전화 주문 1577-2286
- 법인: 계산서 발행, 후불·월 정산 거래처 등록 가능
- 취소: 배송 시작 전이면 전액 환불
- 무료 모바일 부고장·청첩장: 회원가입과 광고 없음, 보낸 뒤에도 고칠 수 있음. 부고장·청첩장 링크나 캡처를 넣으면 주문서가 채워짐
- 상호: ${SHOP.company} (사업자등록번호 ${SHOP.bizNo}), ${SHOP.addr}, 이메일 ${SHOP.email}

## 가격
${CATS.map(rangeLine).filter(Boolean).join("\n")}
- 전체 가격표: ${BASE}/prices

${ORDER_LINKS}

## 페이지
- [전체 상품 가격](${BASE}/prices): ${onSale.length}가지 상품의 이름, 가격, 주문 링크
- [자주 묻는 것](${BASE}/faq): 마감, 배송비, 빈소 호실, 리본, 계산서, 환불
- [전국 장례식장 근조화환](${BASE}/funeral/): 장례식장별 주소, 배송비, 주문 링크
- [무료 모바일 부고장](${BASE}/bugo): 장례식장 이름만 치면 주소가 채워지는 부고장
- [무료 모바일 청첩장](${BASE}/wedding-card)
- [신부 부케 예약](${BASE}/wedding.html): 토·일 각 1~2건 예약제
- [이용약관](${BASE}/terms.html)

## Optional
- [전체 내용](${BASE}/llms-full.txt): 전 상품 목록, 자주 묻는 것 전문, 추가 배송비 지역
`;
}

export function llmsFullTxt() {
  const fee = {};
  // 같은 이름이 여러 도에 있는 곳은 도를 붙인다(고성군은 경남, 동명면은 경북 칠곡).
  const where = (e) => { const pv = (e.prov || []).filter((x) => !/^(경상|충청|전라)[남북]$/.test(x)); return pv.length ? `${e.n}(${pv.join(" ")})` : e.n; };
  for (const e of REGION.EXTRA || []) (fee[e.amt] = fee[e.amt] || []).push(where(e));
  const blocked = (REGION.BLOCKED || []).map((b) => b.n);
  return llmsTxt() + `
## 전 상품 (코드 · 이름 · 가격)
${CATS.map(([c, label]) => { const l = byCat(c); return l.length ? `### ${label}\n${l.map((p) => `- ${p.pc} · ${itemName(p)} · ${won(p.price)} · 주문 ${BASE}/?pc=${p.pc}`).join("\n")}` : ""; }).filter(Boolean).join("\n\n")}

## 자주 묻는 것
${FAQ.map(([q, a]) => `### ${q}\n${a}`).join("\n\n")}

## 추가 배송비 지역
주소에 아래 지역이 들어 있으면 배송비가 더해져요. 주문서가 주소를 보고 자동으로 넣어요.
${Object.keys(fee).sort((a, b) => a - b).map((amt) => `- ${won(+amt)}: ${fee[amt].join(", ")}`).join("\n")}
- 배송이 어려운 곳: ${blocked.join(", ")} (전화로 먼저 확인)
`;
}

export function buildAi() {
  const out = { "prices.html": pricesHtml(), "faq.html": faqHtml(), "llms.txt": llmsTxt(), "llms-full.txt": llmsFullTxt() };
  for (const [f, s] of Object.entries(out)) fs.writeFileSync(path.join(ROOT, f), s);
  return Object.keys(out);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log("AI 안내 파일 생성 → " + buildAi().join(", "));
}
