// scripts/build-guide.mjs
// 꽃 선물 묻고 답하기(/guide/, 11/27). 손님이 "챗GPT 보고 왔다"고 해서, AI 검색이 그대로 따다 쓸 수 있게
// 질문 하나에 페이지 하나, 첫 문단에 바로 답을 적는다. 화면에 보이는 질문만 FAQPage 데이터에 넣는다.
//
// 가격·이름·사진은 products.mjs 에서 읽는다(본문의 [[상품코드]] → "49,000원"). 리본 문구는 주문서(index.html 의 RIBBON)에
// 있는 것만 쓴다 — 없으면 멈춘다. 마감·배송비·환불·사진 문자 같은 규칙은 faq.html(build-ai.mjs FAQ)과 같은 말만 쓴다.
// 손으로 guide/*.html 을 고치지 말고 여기를 고쳐 다시 돌릴 것.
// 실행: node scripts/build-guide.mjs   → guide/index.html, guide/<slug>.html

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PRODUCTS } from "../products.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.PUBLIC_BASE_URL || "https://floweranbu.co.kr").replace(/\/+$/, "");
export const UPDATED = "2026-11-27";
const UTM = "utm_source=guide";

const RIBBON = (() => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const m = html.match(/const RIBBON = (\{[\s\S]*?\n\});/);
  if (!m) throw new Error("index.html 에서 RIBBON 을 못 찾았어요");
  return vm.runInNewContext("(" + m[1] + ")");
})();
const RIBBON_ALL = new Set(Object.values(RIBBON).flatMap((g) => Object.entries(g).filter(([k]) => k !== "tones").flatMap(([, l]) => l)));

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const won = (n) => n.toLocaleString("ko-KR") + "원";
const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, "\\u003c")}</script>`;
const onSale = PRODUCTS.filter((p) => p.status !== "품절" && p.price > 0);
const prod = (pc) => { const p = onSale.find((x) => x.pc === pc); if (!p) throw new Error(`판매 중인 상품이 아니에요: ${pc}`); return p; };
const byCat = (c) => onSale.filter((p) => p.cat === c).sort((a, b) => a.price - b.price || a.pc.localeCompare(b.pc));
const minOf = (c) => won(byCat(c)[0].price);
const maxOf = (c) => { const l = byCat(c); return won(l[l.length - 1].price); };
const label = (p) => (p.subtitle ? `${p.name} (${p.subtitle})` : p.name) + (p.cat === "orchid" && p.sub ? ` · ${p.sub}` : "");
// 주문서에 있는 리본 문구만 쓴다.
const rb = (t) => { if (!RIBBON_ALL.has(t)) throw new Error(`주문서에 없는 리본 문구: ${t}`); return t; };
// 본문 [[WC-01]] → 가격. {{condolence:min}} / {{condolence:max}} / {{condolence:n}} → 분류 최저·최고가·개수.
const fill = (s) => s
  .replace(/\[\[([A-Z]{2}-\d{2,3})\]\]/g, (_, pc) => won(prod(pc).price))
  .replace(/\{\{(\w+):(min|max|n)\}\}/g, (_, c, k) => (k === "min" ? minOf(c) : k === "max" ? maxOf(c) : String(byCat(c).length)));
const plain = (html) => fill(html).replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

const FUNERAL = `/?worder=funeral&${UTM}`;
const order = (pc) => `/?pc=${encodeURIComponent(pc)}&${UTM}`;
const tel = '<a class="nw" href="tel:15772286">1577-2286</a>';

// 마감·사진 문자·배송비·취소는 faq.html 과 같은 문장.
const Q_TODAY = ["오늘 받을 수 있나요?", `평일 18시, 주말 16시까지 주문하면 오늘 도착해요. 그보다 늦으면 다음 날 보내 드려요. 급하면 ${tel}으로 전화 주세요.`];
const Q_PHOTO = ["도착했는지 알 수 있나요?", "배송하고 바로 도착 사진을 문자로 보내 드려요."];
const Q_FEE = ["배송비가 따로 있나요?", "상품 가격에 기본 배송비가 들어 있어요. 거리가 먼 일부 지역은 1만 원에서 3만 원이 더해지고, 주소를 넣으면 주문서가 바로 계산해 드려요."];
const Q_BILL = ["회사 이름으로 보내고 계산서를 받을 수 있나요?", `주문서에서 법인·단체를 펼쳐 사업자 정보를 넣으면 계산서를 발행해 드려요. 자주 보내는 회사는 후불과 월 정산 거래처로 등록할 수 있어요(${tel}).`];
const Q_SAME = ["사진과 똑같이 오나요?", "계절과 꽃 수급에 따라 사진과 조금 다를 수 있어요. 그럴 때는 같은 등급 이상으로 만들어 드려요."];

export const GUIDES = [
  {
    slug: "funeral-timing", short: "근조화환 보내는 시기",
    q: "장례식장에 근조화환은 언제까지 보내야 하나요?",
    title: "장례식장에 근조화환은 언제까지 보내야 하나요? | 꽃안부",
    a: `근조화환은 발인 전에 빈소에 도착해야 해요. 발인이 끝나면 빈소를 정리해서 화환을 둘 곳이 없어지니, 부고를 받으면 되도록 빨리 보내는 게 좋아요. 꽃안부는 평일 18시, 주말 16시까지 주문하면 오늘 도착하고, 발인이 내일 아침이라면 ${tel}으로 전화 주시면 발인 전에 닿도록 바로 보내 드려요.`,
    sections: [
      ["부고를 받으면 되도록 빨리 보내요", `<p>장례는 며칠 안에 끝나요. 빈소를 차린 날이나 다음 날 도착하면 조문 오는 분들이 오가는 동안 화환이 빈소를 지켜요. 늦어도 발인 전날까지는 도착하게 보내는 게 마음이 편해요.</p>`],
      ["오늘 도착 마감 시간", `<p>평일 18시, 주말 16시까지 주문하면 오늘 도착해요. 그보다 늦으면 다음 날 보내 드려요. 마감이 지났는데 발인이 가깝다면 주문서 대신 ${tel}으로 전화 주세요.</p>`],
      ["주문할 때 필요한 것", `<ul><li>장례식장 이름 (주소는 몰라도 돼요)</li><li>고인 성함과 상주 이름</li><li>빈소 호실 (몰라도 돼요. 사장님이 장례식장에 확인해서 보내 드려요)</li></ul><p>부고장 링크나 캡처 사진만 있다면 꽃안부 첫 화면 칸에 붙여 넣어 주세요. 고인 성함, 장례식장, 발인 시간을 읽어 주문서를 채워 드려요.</p>`],
    ],
    faq: [
      ["발인이 내일 아침이에요.", `전화(${tel})로 주문해 주세요. 발인 전에 닿도록 바로 보내 드려요.`],
      ["장례식장 빈소 호실을 몰라도 되나요?", "비워 두셔도 돼요. 사장님이 장례식장에 확인해서 보내 드려요."],
      Q_PHOTO,
    ],
    items: ["WC-01", "WC-04", "WC-02"],
    cta: ["근조화환 보내기", FUNERAL, "condolence"],
    related: ["funeral-price", "funeral-ribbon", "wreath-or-money"],
  },
  {
    slug: "funeral-price", short: "근조화환 가격",
    q: "근조화환 가격은 얼마가 적당한가요?",
    title: "근조화환 가격은 얼마가 적당한가요? | 꽃안부",
    a: "근조화환은 정해진 금액이 없고, 보내는 분과 고인·유족과의 사이에 맞춰 고르면 돼요. 꽃안부 근조화환은 {{condolence:min}}부터 {{condolence:max}}까지 {{condolence:n}}가지이고, 모든 가격에 기본 배송비가 들어 있어요. 개인이 보낼 때는 기본형도 충분하고, 회사나 단체 이름으로 보낼 때는 한두 단계 큰 것을 고르기도 해요.",
    sections: [
      ["꽃안부 근조화환 가격", `<p>아래 가격에 기본 배송비가 들어 있어요. 거리가 먼 일부 지역만 1만~3만 원이 더해지고, 주소를 넣으면 주문서가 바로 계산해 드려요.</p>`, "condolence"],
      ["어떻게 고르면 좋을까요?", `<ul><li>개인이 마음을 전할 때: 근조 보통([[WC-01]])이나 근조 일반1호([[WC-04]])</li><li>회사·거래처·단체 이름으로 보낼 때: 근조 일반2호([[WC-05]])나 근조 스페셜([[WC-02]])</li><li>여럿이 함께 보내거나 더 크게 하고 싶을 때: 근조 특대([[WC-06]])</li></ul><p>금액보다 발인 전에 제때 도착하는 게 더 중요해요.</p>`],
    ],
    faq: [Q_FEE, Q_BILL, Q_SAME],
    items: [],
    cta: ["근조화환 보내기", FUNERAL, "condolence"],
    related: ["funeral-timing", "funeral-ribbon", "wreath-or-money"],
  },
  {
    slug: "funeral-ribbon", short: "근조화환 리본 문구",
    q: "근조화환 리본 문구는 어떻게 쓰나요?",
    title: "근조화환 리본 문구는 어떻게 쓰나요? | 꽃안부",
    a: `근조화환에는 리본이 두 줄 달려요. 한 줄에는 '${rb("삼가 故人(고인)의 冥福(명복)을 빕니다")}' 같은 위로 문구를, 다른 한 줄에는 '주식회사 ○○ 대표이사 ○○○'처럼 보내는 분 이름을 적어요. 꽃안부 주문서에서 문구를 고르거나, 받는 분과의 관계를 적으면 맞는 문구를 골라 드려요.`,
    sections: [
      ["가장 많이 쓰는 문구", `<ul>${RIBBON.funeral.formal.map((t) => `<li>${esc(rb(t))}</li>`).join("")}</ul>`],
      ["회사·거래처 이름으로 보낼 때", `<ul>${["謹弔 (근조)", "삼가 弔意(조의)를 표합니다", "고인의 명복을 빌며 깊은 위로를 전합니다"].map((t) => `<li>${esc(rb(t))}</li>`).join("")}</ul>`],
      ["보내는 분 이름은 이렇게 적어요", `<ul><li>주식회사 ○○ 대표이사 ○○○</li><li>○○주식회사 임직원 일동</li><li>○○팀 일동</li><li>○○고등학교 ○회 동창 일동</li><li>○○○ (개인 이름)</li></ul><p>더 많은 문구는 <a href="/ribbon/condolence">근조화환 리본 문구 모음</a>에서 눌러 복사할 수 있어요.</p>`],
    ],
    faq: [
      ["한자로 꼭 써야 하나요?", `꼭 그렇지는 않아요. '${rb("고인의 명복을 빌며 깊은 위로를 전합니다")}', '${rb("마음 깊이 애도하며 위로를 전합니다")}'처럼 한글 문구도 있어요.`],
      ["리본 문구는 어떻게 정하나요?", `주문서에서 고르거나, 받는 분과의 관계를 적으면 맞는 문구를 골라 드려요. 보내는 분 이름도 리본에 들어가요. 많이 쓰는 문구는 <a href="/ribbon/">리본 문구 모음</a>에 모아 뒀어요.`],
      ["회사 이름으로 보낼 때는 어떻게 쓰나요?", `위로 문구는 '${rb("謹弔 (근조)")}'나 '${rb("삼가 弔意(조의)를 표합니다")}'를 쓰고, 이름 줄에는 '○○주식회사 임직원 일동'이나 '주식회사 ○○ 대표이사 ○○○'처럼 적어요.`],
    ],
    items: ["WC-01", "WC-04"],
    cta: ["근조화환 보내기", FUNERAL, "condolence"],
    related: ["funeral-timing", "funeral-price", "wreath-or-money"],
  },
  {
    slug: "wreath-or-money", short: "화환과 조의금",
    q: "화환과 조의금, 둘 다 해야 하나요?",
    title: "화환과 조의금, 둘 다 해야 하나요? | 꽃안부",
    a: "꼭 둘 다 해야 하는 건 아니에요. 직접 조문할 때는 조의금으로, 조문하기 어렵거나 회사·단체 이름으로 마음을 전할 때는 근조화환으로 하는 경우가 많아요. 가까운 사이라면 둘 다 하기도 하고, 어느 쪽이든 정성이 전해지면 충분해요.",
    sections: [
      ["근조화환이 잘 맞을 때", `<ul><li>멀리 있거나 일정 때문에 직접 조문하기 어려울 때</li><li>회사, 거래처, 동창회처럼 여럿의 이름으로 마음을 전할 때</li><li>빈소에 위로의 뜻이 눈에 보이게 남았으면 할 때</li></ul>`],
      ["조의금이 잘 맞을 때", `<ul><li>직접 빈소에 가서 조문할 때</li><li>유족이 화환을 받지 않겠다고 미리 알렸을 때</li></ul>`],
      ["유족이 화환을 사양했다면", `<p>부고에 화환을 정중히 사양한다는 말이 있다면 그 뜻을 따르는 게 좋아요. 꽃안부 무료 부고장에도 화환 보내기 칸이 있는데, 유족이 이 칸을 끌 수 있어요.</p>`],
    ],
    faq: [
      ["조문을 못 가는데 화환만 보내도 되나요?", "괜찮아요. 직접 가기 어려울 때 근조화환으로 마음을 전해도 돼요. 리본에 보내는 분 이름이 들어가서 유족이 누가 보냈는지 알 수 있어요."],
      ["부고장 링크만 있는데 주문할 수 있나요?", "링크나 캡처 사진을 꽃안부 첫 화면 칸에 넣으면 고인 성함, 장례식장, 발인 시간을 읽어 주문서를 채워 드려요. 채워진 내용을 한 번 보고 결제하시면 돼요."],
      Q_PHOTO,
    ],
    items: ["WC-01", "WC-04"],
    cta: ["근조화환 보내기", FUNERAL, "condolence"],
    related: ["funeral-timing", "funeral-price", "funeral-ribbon"],
  },
  {
    slug: "girlfriend-flowers", short: "여자친구 꽃 선물",
    q: "여자친구에게 꽃 선물, 무엇을 보내면 좋을까요?",
    title: "여자친구에게 꽃 선물, 무엇을 보내면 좋을까요? | 꽃안부",
    a: "생일, 기념일, 사과, 고백처럼 마음을 전하는 날에는 손에 들기 좋은 꽃다발이 가장 무난해요. 꽃안부에서는 빨간장미 온마음([[BQ-007]]), 분홍장미 발그레([[BQ-006]]), 분홍튤립 봄마중([[BQ-004]])을 추천해요. 회사나 집으로 보낼 수 있고, 카드 문구를 넣을 수 있어요.",
    sections: [
      ["어떤 꽃다발을 고를까요?", `<ul><li>마음을 분명하게 전하고 싶을 때: 빨간장미 온마음([[BQ-007]])</li><li>부드럽고 사랑스러운 느낌: 분홍장미 발그레([[BQ-006]])</li><li>가볍게 깜짝 선물: 분홍튤립 봄마중([[BQ-004]])</li></ul><p>꽃다발은 {{bouquet:min}}부터 {{bouquet:max}}까지 {{bouquet:n}}가지가 있어요.</p>`],
      ["보내기 전에 준비할 것", `<ul><li>받는 분 이름과 연락처</li><li>받을 곳 주소 (회사나 집)</li><li>카드에 넣을 짧은 한마디</li></ul><p>도착하면 사진을 문자로 보내 드려서, 잘 받았는지 바로 알 수 있어요.</p>`],
    ],
    faq: [
      ["회사로 보내도 되나요?", "네, 회사나 집 어디로든 보낼 수 있어요. 받는 분 이름과 연락처를 적어 주세요."],
      Q_TODAY,
      Q_SAME,
    ],
    items: ["BQ-007", "BQ-006", "BQ-004"],
    cta: ["꽃다발 보러 가기", "/prices?utm_source=guide#bouquet", "bouquet"],
    related: ["parents-birthday", "opening-gift", "promotion-orchid"],
  },
  {
    slug: "parents-birthday", short: "부모님 생신 꽃",
    q: "부모님 생신 꽃 선물, 무엇이 좋을까요?",
    title: "부모님 생신 꽃 선물 추천 | 무엇이 좋을까요? | 꽃안부",
    a: "부모님 생신에는 꽃병을 따로 준비하지 않아도 되는 꽃바구니가 무난해요. 꽃안부에서는 카네이션 연지곤지([[BS-013]])와 카네이션백합 꽃단장([[BS-014]])을 추천해요. 용돈을 함께 드리려면 특대 용돈바구니 복바구니([[BS-004]])나 용돈꽃다발 복주머니([[BQ-001]])를 골라요.",
    sections: [
      ["꽃바구니가 좋은 까닭", `<p>꽃바구니는 받는 분이 꽃병을 따로 준비하지 않아도 돼요. 그대로 거실이나 식탁에 두면 돼서 부모님께 드리기 편해요. 어버이날이나 환갑에도 잘 어울려요.</p>`],
      ["용돈을 함께 드리고 싶다면", `<ul><li>복바구니 (특대 용돈바구니, [[BS-004]])</li><li>복주머니 (용돈꽃다발, [[BQ-001]])</li></ul>`],
      ["리본·카드 문구 예시", `<ul>${["생신을 진심으로 축하합니다", "건강과 행복이 가득하시길", "늘 건강하시고 행복하세요", "사랑과 감사를 담아"].map((t) => `<li>${esc(rb(t))}</li>`).join("")}</ul><p>더 많은 문구는 <a href="/ribbon/celebration">개업·승진·생신 리본 문구</a>에 있어요.</p>`],
    ],
    faq: [
      ["멀리 사시는 부모님께도 보낼 수 있나요?", "전국으로 보내요. 거리가 먼 일부 지역은 1만 원에서 3만 원이 더해지고, 주소를 넣으면 주문서가 바로 계산해 드려요."],
      Q_TODAY,
      Q_PHOTO,
    ],
    items: ["BS-013", "BS-014", "BS-004", "BQ-001"],
    cta: ["꽃바구니 보러 가기", "/prices?utm_source=guide#basket", "basket"],
    related: ["girlfriend-flowers", "opening-gift", "promotion-orchid"],
  },
  {
    slug: "opening-gift", short: "개업 선물",
    q: "개업 선물로 화환·식물·난 중 무엇이 좋을까요?",
    title: "개업 선물로 화환·식물·난 중 무엇이 좋을까요? | 꽃안부",
    a: "오래 두고 보는 선물을 원하면 관엽식물이 가장 무난해요. 개업 당일 매장 앞을 환하게 꾸며 주고 싶다면 축하화환이나 쌀화환을, 사무실이나 병원처럼 차분한 곳이라면 난도 잘 어울려요. 꽃안부 관엽식물은 금전수([[PL-003]]), 녹보수([[PL-009]]), 스투키([[PL-019]])를 추천해요.",
    sections: [
      ["한눈에 비교", `<dl class="kv cmp"><dt>관엽식물</dt><dd>매장 안에 오래 두고 봐요. {{plant:min}}부터</dd><dt>축하화환</dt><dd>개업 당일 매장 앞에 세워요. 쌀화환도 있어요. {{congrats:min}}부터</dd><dt>난</dt><dd>사무실·병원·카운터에 두기 좋아요. {{orchid:min}}부터</dd></dl>`],
      ["관엽식물", `<p>금전수([[PL-003]]부터), 녹보수([[PL-009]]부터), 스투키([[PL-019]]부터)를 추천해요. 공간이 넓다면 높이 1m가 넘는 큰 화분도 있어요.</p>`],
      ["축하화환·쌀화환", `<p>매장 앞에 세울 화환은 축하 보통([[WG-01]])이나 쌀화환 10kg([[WG-06]])을 추천해요.</p>`],
      ["리본 문구", `<ul>${["祝 開業 (축 개업)", "번창을 기원합니다", "새로운 출발을 축하합니다", "祝 發展 (축 발전)"].map((t) => `<li>${esc(rb(t))}</li>`).join("")}</ul><p>더 많은 문구는 <a href="/ribbon/celebration">개업·승진·생신 리본 문구</a>에 있어요.</p>`],
    ],
    faq: [Q_TODAY, Q_BILL, Q_FEE],
    items: ["PL-003", "PL-009", "PL-019", "WG-01", "WG-06"],
    cta: ["개업 화분 보러 가기", "/prices?utm_source=guide#plant", "plant"],
    related: ["promotion-orchid", "parents-birthday", "girlfriend-flowers"],
  },
  {
    slug: "promotion-orchid", short: "승진·취임 난",
    q: "승진·취임 축하 난은 어떻게 보내나요?",
    title: "승진·취임 축하 난 보내는 법 | 꽃안부",
    a: "승진·취임·영전을 축하할 때는 난을 많이 보내요. 꽃안부에서는 호접란([[OR-008]]부터)이 무난하고, 리본에는 '祝 昇進(축 승진)' 같은 축하 문구와 보내는 분의 직함·이름을 적어요. 받는 분 이름과 연락처, 회사 주소를 알면 바로 주문할 수 있어요.",
    sections: [
      ["호접란과 동양란", `<ul><li>호접란(서양란): 꽃이 크고 화사해서 축하 자리에 잘 어울려요. [[OR-008]]부터</li><li>동양란: 철골소심([[OR-003]]), 황룡금([[OR-007]]) 등. 잎이 단정해 사무실에 두기 좋아요.</li></ul><p>난은 {{orchid:min}}부터 {{orchid:max}}까지 {{orchid:n}}가지가 있어요.</p>`],
      ["리본 문구", `<ul>${["祝 昇進 (축 승진)", "祝 榮轉 (축 영전)", "祝 就任 (축 취임)", "진심으로 축하드립니다"].map((t) => `<li>${esc(rb(t))}</li>`).join("")}</ul>`],
      ["보내는 분 이름 적는 법", `<ul><li>주식회사 ○○ 대표이사 ○○○</li><li>○○팀 일동</li><li>○○○ (개인 이름)</li></ul><p>더 많은 문구는 <a href="/ribbon/celebration">개업·승진·생신 리본 문구</a>에 있어요.</p>`],
    ],
    faq: [
      ["언제 보내면 좋나요?", "소식을 들은 뒤 되도록 빨리 보내는 게 좋아요. 취임식처럼 날이 정해져 있다면 그 전에 닿게 보내요. 평일 18시, 주말 16시까지 주문하면 오늘 도착해요."],
      Q_BILL,
      Q_PHOTO,
    ],
    items: ["OR-008", "OR-009", "OR-003", "OR-007"],
    cta: ["축하 난 보러 가기", "/prices?utm_source=guide#orchid", "orchid"],
    related: ["opening-gift", "parents-birthday", "girlfriend-flowers"],
  },
];

const CSS = `:root{--paper:#fff;--bg:#f7f6f2;--ink:#1f1d18;--soft:#5a564d;--faint:#8a857a;--line:#e4e1d8;--accent:#1f4733}
@media (prefers-color-scheme:dark){:root{--paper:#202124;--bg:#17181a;--ink:#eceae4;--soft:#c4c0b6;--faint:#a5a197;--line:#2c2d30;--accent:#7fc29b}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.7 -apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;word-break:keep-all;overflow-wrap:anywhere}
a{color:var(--accent)}.w{max-width:720px;margin:0 auto;padding:20px 16px 48px}
.top{display:flex;justify-content:space-between;align-items:center;font-size:14px}.top a{text-decoration:none;font-weight:700}
h1{margin:18px 0 6px;font-size:25px;line-height:1.35}.lead{margin:0;color:var(--soft)}
.box{margin-top:16px;padding:16px;border:1px solid var(--line);border-radius:14px;background:var(--paper)}
.kv{display:grid;grid-template-columns:76px 1fr;gap:6px 10px;margin:0;font-size:15px}.kv dt{color:var(--faint)}.kv dd{margin:0}
h2{margin:28px 0 2px;font-size:19px}.cd{margin:0 0 8px;color:var(--soft);font-size:14px}
ul.it{list-style:none;margin:8px 0 0;padding:0;border-top:1px solid var(--line)}
ul.it li{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)}
ul.it img{width:64px;height:64px;border-radius:10px;object-fit:cover;background:#eee;flex:0 0 auto;display:block}
ul.it .nm{flex:1;min-width:0}ul.it .nm b{display:block;font-size:15px;font-weight:600}ul.it .nm span{font-size:16px;font-weight:800}
ul.it .buy{flex:0 0 auto;padding:9px 14px;border-radius:10px;background:var(--accent);color:#fff;font-size:14px;font-weight:700;text-decoration:none}
.qa{margin-top:10px}.qa h3{font-size:17px;margin:18px 0 4px}.qa p{margin:0;color:var(--soft)}
.go{display:block;margin-top:22px;padding:15px;border-radius:14px;background:var(--accent);color:#fff;text-align:center;font-size:16px;font-weight:800;text-decoration:none}
.foot{margin-top:30px;font-size:13px;color:var(--faint)}.nw{white-space:nowrap}
.by{margin:4px 0 0;font-size:13px;color:var(--faint)}
.ans{margin-top:14px;font-size:17px;line-height:1.75}.ans p{margin:0}
.sec p{margin:6px 0 0;color:var(--soft)}.sec ul{margin:6px 0 0;padding-left:20px;color:var(--soft)}.sec li{margin:2px 0}
.cmp{grid-template-columns:84px 1fr;margin-top:8px;padding:14px;border:1px solid var(--line);border-radius:14px;background:var(--paper)}.cmp dt{color:var(--ink);font-weight:700}
ul.gl{list-style:none;margin:16px 0 0;padding:0;border-top:1px solid var(--line)}ul.gl li{padding:14px 0;border-bottom:1px solid var(--line)}
ul.gl a{display:block;font-size:17px;font-weight:700;text-decoration:none}ul.gl p{margin:4px 0 0;color:var(--soft);font-size:15px}
.rel{margin-top:26px;font-size:15px}.rel a{display:block;padding:6px 0}`;

const SHOP_LINE = "꽃안부 · 주식회사 아마존 · 대표 권점숙 · 사업자등록번호 234-86-00344 · 통신판매업 제2026-경기시흥-1357호 · 경기 시흥시 신천3길 23, 103호 · 1577-2286 · amazonflower@naver.com";
const topBar = `<div class="top"><a href="/">꽃안부</a><a href="tel:1577-2286">전화 1577-2286</a></div>`;
const byline = `<p class="by">꽃안부 · 1993년부터 경기 시흥 꽃집 · <time datetime="${UPDATED}">${UPDATED}</time> 확인</p>`;
const foot = (more) => `<p class="foot">${more}<br>${esc(SHOP_LINE)}</p>`;

function head(title, desc, canon, extra) {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canon)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="꽃안부">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canon)}">
<meta property="og:image" content="${BASE}/og_preview.png">
<meta property="article:modified_time" content="${UPDATED}">
<meta name="theme-color" content="#1f4733">
<link rel="icon" href="/favicon.ico">
<style>${CSS}</style>
${extra}
<script src="/va.js?v=20261025a" defer></script>
</head>`;
}

const itemRow = (p) => `<li>${p.photos && p.photos[0] ? `<a href="/catalog.html?item=${encodeURIComponent(p.pc)}"><img src="${esc(p.photos[0])}" alt="${esc(label(p))}" loading="lazy" width="64" height="64"></a>` : ""}<div class="nm"><b><a href="/catalog.html?item=${encodeURIComponent(p.pc)}" style="color:inherit;text-decoration:none">${esc(label(p))}</a></b><span>${won(p.price)}</span></div><a class="buy" href="${esc(order(p.pc))}">주문</a></li>`;
const itemList = (list) => (list.length ? `<ul class="it">${list.map(itemRow).join("")}</ul>` : "");
const crumbs = (extra) => ({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
  { "@type": "ListItem", position: 1, name: "꽃안부", item: BASE + "/" },
  { "@type": "ListItem", position: 2, name: "꽃 선물 묻고 답하기", item: BASE + "/guide/" },
  ...(extra ? [{ "@type": "ListItem", position: 3, name: extra[0], item: extra[1] }] : []) ] });

export function guideHtml(g) {
  const url = `${BASE}/guide/${g.slug}`;
  const answer = plain(g.a);
  const faq = { "@context": "https://schema.org", "@type": "FAQPage", url, inLanguage: "ko", dateModified: UPDATED,
    publisher: { "@type": "Florist", "@id": BASE + "/#shop", name: "꽃안부" },
    mainEntity: [[g.q, g.a], ...g.faq].map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: plain(a) } })) };
  const sections = g.sections.map(([h, body, cat]) => `<section class="sec"><h2>${esc(h)}</h2>${fill(body)}${cat ? itemList(byCat(cat)) : ""}</section>`).join("\n");
  const picks = g.items.length ? `<section class="sec"><h2>꽃안부에서 고르기</h2><p>사진을 누르면 크게 보이고, 주문을 누르면 그 상품으로 주문서가 열려요.</p>${itemList(g.items.map(prod))}</section>` : "";
  const rel = g.related.map((s) => GUIDES.find((x) => x.slug === s)).map((x) => `<a href="/guide/${x.slug}">${esc(x.q)}</a>`).join("");
  const from = byCat(g.cta[2])[0];
  return head(g.title, answer, url, ld(faq) + "\n" + ld(crumbs([g.q, url]))) + `
<body><div class="w">
${topBar}
<h1>${esc(g.q)}</h1>
${byline}
<div class="box ans"><p>${fill(g.a)}</p></div>
${sections}
${picks}
<section class="qa"><h2>더 궁금한 것</h2>${g.faq.map(([q, a]) => `<h3>${esc(q)}</h3><p>${fill(a)}</p>`).join("\n")}</section>
<a class="go" href="${esc(g.cta[1])}">${esc(g.cta[0])}${from ? ` · ${won(from.price)}부터` : ""}</a>
<div class="rel"><b>같이 많이 보는 질문</b>${rel}</div>
${foot(`<a href="/guide/">꽃 선물 묻고 답하기</a> · <a href="/prices">전체 상품 가격</a> · <a href="/faq">자주 묻는 것</a> · <a href="/ribbon/">리본 문구 모음</a>`)}
</div></body></html>
`;
}

export function guideIndexHtml() {
  const url = `${BASE}/guide/`;
  const title = "꽃 선물 묻고 답하기 | 근조화환·생신·개업·승진 | 꽃안부";
  const desc = "근조화환은 언제까지, 얼마짜리로, 리본은 어떻게 쓰는지부터 여자친구·부모님·개업·승진 선물까지 자주 묻는 질문에 짧게 답했어요.";
  const list = { "@context": "https://schema.org", "@type": "ItemList", name: "꽃 선물 묻고 답하기", numberOfItems: GUIDES.length,
    itemListElement: GUIDES.map((g, i) => ({ "@type": "ListItem", position: i + 1, name: g.q, url: `${BASE}/guide/${g.slug}` })) };
  return head(title, desc, url, ld(list) + "\n" + ld(crumbs())) + `
<body><div class="w">
${topBar}
<h1>꽃 선물 묻고 답하기</h1>
${byline}
<p class="lead" style="margin-top:10px">꽃을 보낼 때 많이 묻는 질문에 짧게 답했어요. 더 궁금한 건 ${tel}으로 전화 주세요.</p>
<ul class="gl">${GUIDES.map((g) => `<li><a href="/guide/${g.slug}">${esc(g.q)}</a><p>${esc(plain(g.a).split(/(?<=요\.)\s/)[0])}</p></li>`).join("")}</ul>
<a class="go" href="/prices">전체 상품 가격 보기</a>
${foot(`<a href="/">처음으로</a> · <a href="/faq">자주 묻는 것</a> · <a href="/ribbon/">리본 문구 모음</a> · <a href="/funeral/">전국 장례식장 근조화환</a>`)}
</div></body></html>
`;
}

export function buildGuide() {
  const out = { "guide/index.html": guideIndexHtml() };
  for (const g of GUIDES) out[`guide/${g.slug}.html`] = guideHtml(g);
  fs.mkdirSync(path.join(ROOT, "guide"), { recursive: true });
  for (const [f, s] of Object.entries(out)) fs.writeFileSync(path.join(ROOT, f), s);
  return Object.keys(out);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log("묻고 답하기 페이지 생성 → " + buildGuide().join(", "));
}
