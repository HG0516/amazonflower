// 홈 시작 칸 하나로 링크·꽃·가격 찾기(10/20 형구, docs/시안/홈검색-2026-10/검색규칙.html).
// 판단 순서: ① 글 안에 링크가 있으면 그 링크 ② 꽃 종류·상품 이름·가격 → 상품 ③ 상황 말만 → 지금처럼 사연 주문서 ④ 그 밖 → 전체상품 검색.
// 브라우저에선 window.AF_SEARCH, 테스트에선 require 로 쓴다. 상품 목록은 인자로 받는다(products.js 의 PRODUCTS).
(function (root) {
  "use strict";

  // 카톡 부고처럼 글과 링크가 섞여 와도 첫 링크만 뽑는다. 끝에 붙은 문장부호는 뗀다.
  function extractUrl(text) {
    var m = String(text || "").match(/https?:\/\/[^\s<>"'()\[\]{}]+/i);
    return m ? m[0].replace(/[.,!?…·:;~]+$/, "") : "";
  }

  // 가격: 'N만원(대)'는 10만 아래면 만 원 폭, 10만부터는 5만 원 폭. 이하·이상·범위도 읽는다.
  // '만'이 없으면 1만 이상 숫자만 가격으로 본다(날짜·시간 숫자를 가격으로 읽지 않게).
  function won(num, man) {
    var n = parseFloat(String(num).replace(/,/g, ""));
    if (!isFinite(n)) return 0;
    return man ? Math.round(n * 10000) : n;
  }
  function parsePrice(text) {
    var t = String(text || "");
    var r = t.match(/(\d[\d,]*(?:\.\d+)?)\s*(만)?\s*원?\s*(?:~|-|에서|부터)\s*(\d[\d,]*(?:\.\d+)?)\s*(만)?\s*원?\s*(?:사이|까지)?/);
    if (r && (r[2] || r[4] || won(r[3]) >= 10000)) {
      var bMan = !!r[4], aMan = !!r[2] || (bMan && won(r[1]) < 1000);
      var a = won(r[1], aMan), b = won(r[3], bMan);
      if (a > 0 && b >= a) return { min: a, max: b, raw: r[0] };
    }
    var m = t.match(/(\d[\d,]*(?:\.\d+)?)\s*(만)?\s*원?\s*(?:대|짜리|정도|쯤)?\s*(이하|까지|미만|이내|아래|안쪽|이상|넘는|넘게|초과|부터|위로)?/);
    while (m) {
      var v = won(m[1], !!m[2]);
      if (m[2] || v >= 10000) {
        var op = m[3] || "";
        if (/이하|까지|이내|아래|안쪽/.test(op)) return { min: 0, max: v, raw: m[0] };
        if (op === "미만") return { min: 0, max: v - 1, raw: m[0] };
        if (/이상|넘는|넘게|부터|위로/.test(op)) return { min: v, max: 0, raw: m[0] };
        if (op === "초과") return { min: v + 1, max: 0, raw: m[0] };
        var step = v < 100000 ? 10000 : 50000, lo = Math.floor(v / step) * step;
        return { min: lo, max: lo + step - 1, raw: m[0] };
      }
      var rest = t.slice(t.indexOf(m[0]) + m[0].length);
      t = rest; m = t.match(/(\d[\d,]*(?:\.\d+)?)\s*(만)?\s*원?\s*(?:대|짜리|정도|쯤)?\s*(이하|까지|미만|이내|아래|안쪽|이상|넘는|넘게|초과|부터|위로)?/);
    }
    return null;
  }

  // 꽃 종류 말 → 상품 cat. '근조화환'은 근조만, 그냥 '화환'은 근조·축하 둘 다.
  function kindCats(text) {
    var t = String(text || ""), out = [];
    var add = function (c) { if (out.indexOf(c) < 0) out.push(c); };
    if (/꽃다발|다발|부케/.test(t)) add("bouquet");
    if (/바구니/.test(t)) add("basket");
    if (/근조/.test(t)) add("condolence");
    if (/축하\s*화환/.test(t)) add("congrats");
    if (/화환/.test(t) && !/근조|축하\s*화환/.test(t)) { add("condolence"); add("congrats"); }
    if (/호접란|동양란|서양란|양란|난초|(^|[\s,·])난($|[\s,·])/.test(t)) add("orchid");
    if (/화분|관엽|식물|나무/.test(t)) add("plant");
    return out;
  }
  // 상황 말 → 어울리는 cat. 이 말만 있으면 지금처럼 사연·부고·청첩 주문서로 간다.
  var SITUATIONS = [
    [/부고|장례|빈소|조문|발인|별세|소천|상주|돌아가/, ["condolence"]],
    [/결혼|청첩|예식|웨딩|신랑|신부|화혼/, ["congrats"]],
    [/개업|개원|개점|오픈|창업|이전|확장|준공|창립/, ["plant", "congrats"]],
    [/승진|취임|영전|부임|당선|임명/, ["orchid"]],
    [/생신|생일|칠순|팔순|구순|환갑|회갑|고희|기념일|병문안|문병|쾌유|입원|퇴원|출산|백일|졸업|입학|합격|취업|프러포즈/, ["basket", "bouquet"]]
  ];
  function situationCats(text) {
    var t = String(text || ""), out = [];
    SITUATIONS.forEach(function (s) { if (s[0].test(t)) s[1].forEach(function (c) { if (out.indexOf(c) < 0) out.push(c); }); });
    return out;
  }

  function sellable(p) { return p && p.status !== "품절" && (!p.status || p.status === "판매중") && (p.photos || []).length; }

  // 상품 이름으로 찾기. 긴 문장 속 짧은 이름('활짝' 등)에 걸리지 않게 짧은 글에서만 본다.
  function nameHits(text, products) {
    var q = String(text || "").replace(/\s+/g, "");
    if (q.length < 2 || q.length > 12) return [];
    return products.filter(function (p) {
      var nm = String(p.name || "").replace(/\s+/g, "");
      return nm.length >= 2 && (nm.indexOf(q) >= 0 || q.indexOf(nm) >= 0);
    });
  }

  // 판단. kind: empty | link | product | occasion | other
  function analyze(text, products) {
    var q = String(text || "").trim();
    products = (products || []).filter(sellable);
    if (!q) return { kind: "empty" };
    var url = extractUrl(q);
    if (url) return { kind: "link", url: url };
    var sit = situationCats(q);
    // 부고·청첩 문자를 통째로 붙여넣은 긴 글은 사연으로 본다(날짜·이름 속 글자를 상품으로 읽지 않게).
    if (sit.length && q.length > 20) return { kind: "occasion", cats: sit };
    var price = parsePrice(q);
    var term = (price ? q.replace(price.raw, " ") : q).replace(/\s+/g, " ").trim();
    var cats = kindCats(term), names = cats.length ? [] : nameHits(term, products);
    if (cats.length || names.length || price) {
      return { kind: "product", cats: cats.length ? cats : (names.length ? [] : sit), names: names.map(function (p) { return p.pc; }),
        min: price ? price.min : 0, max: price ? price.max : 0, term: term };
    }
    if (sit.length) return { kind: "occasion", cats: sit };
    // 치는 중인 글자(한 글자 '꽃', '근', '꽃다' 등)도 바로 띄운다(10/20 형구): 종류 이름 일부 → 그 종류, 아니면 상품 이름 일부.
    var part = partialCats(term);
    if (part.length) return { kind: "product", cats: part, names: [], min: 0, max: 0, term: term, partial: true };
    var pn = term.length <= 12 ? products.filter(function (p) { return String(p.name || "").indexOf(term) >= 0; }) : [];
    if (pn.length) return { kind: "product", cats: [], names: pn.map(function (p) { return p.pc; }), min: 0, max: 0, term: term, partial: true };
    return { kind: "other", term: q };
  }
  var KIND_WORDS = [["꽃다발", ["bouquet"]], ["꽃바구니", ["basket"]], ["근조화환", ["condolence"]], ["축하화환", ["congrats"]], ["화환", ["condolence", "congrats"]],
    ["호접란", ["orchid"]], ["동양란", ["orchid"]], ["서양란", ["orchid"]], ["관엽식물", ["plant"]], ["화분", ["plant"]]];
  function partialCats(text) {
    var q = String(text || "").replace(/\s+/g, ""), out = [];
    if (!q || q.length > 4) return out;
    KIND_WORDS.forEach(function (w) { if (w[0].indexOf(q) === 0 || (q.length >= 2 && w[0].indexOf(q) >= 0)) w[1].forEach(function (c) { if (out.indexOf(c) < 0) out.push(c); }); });
    return out;
  }

  // 조건에 맞는 상품(싼 순서). band 를 주면 가격 대신 그 가격대 칸(전체상품의 5만대·7만대…)으로 거른다.
  // 가격에 맞는 게 없으면 같은 종류에서 가격이 가장 가까운 것을 near:true 로 돌려준다.
  function match(a, products, band) {
    var list = (products || []).filter(sellable);
    if (a.names && a.names.length) list = list.filter(function (p) { return a.names.indexOf(p.pc) >= 0; });
    else if (a.cats && a.cats.length) list = list.filter(function (p) { return a.cats.indexOf(p.cat) >= 0; });
    list.sort(function (x, y) { return x.price - y.price; });
    var hits;
    if (band) hits = list.filter(function (p) { return p.band === band; });
    else if (a.min || a.max) hits = list.filter(function (p) { return (!a.min || p.price >= a.min) && (!a.max || p.price <= a.max); });
    else return { items: list, near: false };
    if (hits.length || band) return { items: hits, near: false };
    var mid = a.max ? (a.min ? (a.min + a.max) / 2 : a.max) : a.min;
    return { items: list.slice().sort(function (x, y) { return Math.abs(x.price - mid) - Math.abs(y.price - mid) || x.price - y.price; }).slice(0, 3), near: true };
  }

  // 전체상품 검색 결과 주소(catalog.html 이 ?q·cats·min·max·band 를 읽는다).
  function catalogUrl(a, band) {
    var ps = [];
    if (a.kind === "product") {
      if (a.cats && a.cats.length && !(a.names && a.names.length)) ps.push("cats=" + a.cats.join(","));
      else if (a.term) ps.push("q=" + encodeURIComponent(a.term));
      if (band) ps.push("band=" + encodeURIComponent(band));
      else { if (a.min) ps.push("min=" + a.min); if (a.max) ps.push("max=" + a.max); }
    } else if (a.term) ps.push("q=" + encodeURIComponent(a.term));
    return "/catalog.html" + (ps.length ? "?" + ps.join("&") : "");
  }

  // 결과 상자 제목용: '꽃다발 · 5만원대'
  var CAT_KO = { bouquet: "꽃다발", basket: "꽃바구니", condolence: "근조화환", congrats: "축하화환", orchid: "난", plant: "관엽식물" };
  function man(v) { return (v % 10000 ? (v / 10000).toFixed(1).replace(/\.0$/, "") : v / 10000) + "만"; }
  function label(a, band) {
    var bits = [];
    var cats = a.cats || [];
    if (cats.length === 2 && cats.indexOf("condolence") >= 0 && cats.indexOf("congrats") >= 0) bits.push("화환");
    else if (cats.length) bits.push(cats.map(function (c) { return CAT_KO[c]; }).join("·"));
    else if (a.term) bits.push(a.term);
    if (band) bits.push(band);
    else if (a.min && a.max) {
      var w = a.max - a.min + 1;
      bits.push(w === 10000 || w === 50000 ? man(a.min) + "원대" : man(a.min) + "~" + man(a.max) + "원");
    } else if (a.max) bits.push(man(a.max) + "원 이하");
    else if (a.min) bits.push(man(a.min) + "원 이상");
    return bits.join(" · ");
  }

  var api = { extractUrl: extractUrl, parsePrice: parsePrice, kindCats: kindCats, situationCats: situationCats, analyze: analyze, match: match, catalogUrl: catalogUrl, label: label };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AF_SEARCH = api;
})(typeof window !== "undefined" ? window : this);
