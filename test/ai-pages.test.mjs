// AI 검색용 파일(scripts/build-ai.mjs): 가격이 products.mjs 와 같은지, 데이터가 깨지지 않는지, 올린 파일이 최신인지.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PRODUCTS } from "../products.mjs";
import { pricesHtml, faqHtml, llmsTxt, llmsFullTxt, FAQ, itemName } from "../scripts/build-ai.mjs";

const lds = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const sale = PRODUCTS.filter((p) => p.status !== "품절" && p.price > 0);

test("가격표: 판매 중인 상품이 모두 같은 가격으로, 데이터에도 같은 수로", () => {
  const html = pricesHtml();
  for (const p of sale) {
    assert.ok(html.includes(`id="${p.pc}"`), p.pc);
    assert.ok(html.includes(`/?pc=${p.pc}`), p.pc);
  }
  const list = lds(html).find((o) => o["@type"] === "ItemList");
  assert.equal(list.itemListElement.length, sale.length);
  for (const li of list.itemListElement) {
    const p = PRODUCTS.find((x) => x.pc === li.item.sku);
    assert.equal(li.item.offers.price, p.price, p.pc);
    assert.equal(li.item.offers.priceCurrency, "KRW");
  }
});

test("이름이 같은 관엽은 크기로 갈린다", () => {
  const names = sale.filter((p) => p.cat === "plant").map(itemName);
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  assert.ok(dup.length < names.length / 4, "겹치는 이름이 너무 많다: " + dup.slice(0, 5).join(", "));
});

test("자주 묻는 것: 화면과 데이터가 같은 질문", () => {
  const html = faqHtml();
  const faq = lds(html).find((o) => o["@type"] === "FAQPage");
  assert.equal(faq.mainEntity.length, FAQ.length);
  for (const [q] of FAQ) assert.ok(html.includes(q.replace(/&/g, "&amp;")), q);
});

test("llms.txt: 주문 링크 규칙과 주요 페이지", () => {
  const t = llmsTxt();
  assert.match(t, /^# 꽃안부\n\n> /);
  for (const s of ["?worder=funeral&v=", "?worder=wedding&v=", "?pc=", "/prices", "/faq", "/funeral/", "1577-2286", "평일 18시"]) assert.ok(t.includes(s), s);
  const full = llmsFullTxt();
  for (const p of sale) assert.ok(full.includes(`${p.pc} · `), p.pc);
  assert.match(full, /추가 배송비 지역/);
});

test("올린 파일이 지금 상품과 같다(products.mjs 를 바꾸고 build-ai 를 안 돌리면 실패)", () => {
  assert.equal(fs.readFileSync(new URL("../prices.html", import.meta.url), "utf8"), pricesHtml());
  assert.equal(fs.readFileSync(new URL("../llms-full.txt", import.meta.url), "utf8"), llmsFullTxt());
});

test("장례식장 페이지: 서비스 데이터가 읽히고 가격이 있다", () => {
  const dir = new URL("../funeral/", import.meta.url);
  const f = fs.readdirSync(dir).find((x) => x !== "index.html" && x.endsWith(".html"));
  const g = lds(fs.readFileSync(new URL(f, dir), "utf8"))[0]["@graph"];
  const svc = g.find((o) => o["@type"] === "Service");
  assert.ok(svc.offers.lowPrice >= 49000 && svc.offers.highPrice >= svc.offers.lowPrice);
  assert.equal(svc.provider["@id"], "https://floweranbu.co.kr/#shop");
});

test("홈 가게 데이터가 읽힌다", () => {
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const g = lds(html).flatMap((o) => o["@graph"] || [o]);
  const shop = g.find((o) => o["@type"] === "Florist");
  assert.equal(shop["@id"], "https://floweranbu.co.kr/#shop");
  assert.equal(shop.telephone, "+82-1577-2286");
});

import { RIBBON, RIBBON_PAGES, ribbonHtml } from "../scripts/build-ai.mjs";
test("리본 문구 페이지: 주문서에 있는 문구만, 올린 파일이 최신", () => {
  const all = new Set(Object.values(RIBBON).flatMap((g) => Object.entries(g).filter(([k]) => k !== "tones").flatMap(([, l]) => l)));
  all.add("진심으로 축하드립니다");   // 승진·취임 묶음에 더한 한 줄(주문서 general.congrat 에 있음)
  for (const pg of RIBBON_PAGES) {
    const groups = pg.groups();
    assert.ok(groups.every(([, l]) => l.length), pg.slug + " 빈 묶음");
    for (const [, l] of groups) for (const t of l) assert.ok(all.has(t), `${pg.slug}: 주문서에 없는 문구 ${t}`);
    assert.equal(fs.readFileSync(new URL(`../ribbon/${pg.slug}.html`, import.meta.url), "utf8"), ribbonHtml(pg));
  }
});
