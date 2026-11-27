// 꽃 선물 묻고 답하기(scripts/build-guide.mjs): 데이터가 읽히는지, 화면과 FAQ 데이터가 같은지, 올린 파일이 최신인지.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { GUIDES, guideHtml, guideIndexHtml } from "../scripts/build-guide.mjs";

const lds = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

test("묻고 답하기: FAQ 데이터의 질문이 모두 화면에 있고, 주소·사이트맵이 맞다", () => {
  const sm = fs.readFileSync(new URL("../sitemap.xml", import.meta.url), "utf8");
  assert.ok(sm.includes("https://floweranbu.co.kr/guide/</loc>"));
  for (const g of GUIDES) {
    const html = guideHtml(g);
    const faq = lds(html).find((o) => o["@type"] === "FAQPage");
    assert.equal(faq.mainEntity[0].name, g.q);
    for (const q of faq.mainEntity) assert.ok(html.includes(q.name.replace(/&/g, "&amp;")), `${g.slug}: ${q.name}`);
    assert.ok(lds(html).some((o) => o["@type"] === "BreadcrumbList"));
    assert.ok(html.includes(`<link rel="canonical" href="https://floweranbu.co.kr/guide/${g.slug}">`));
    assert.ok(!/\[\[|\{\{/.test(html), g.slug + " 안 바뀐 자리표시");
    assert.ok(sm.includes(`/guide/${g.slug}</loc>`), g.slug + " 사이트맵");
  }
});

test("묻고 답하기: 올린 파일이 최신(products.mjs 를 바꾸면 build-guide 를 다시 돌릴 것)", () => {
  assert.equal(fs.readFileSync(new URL("../guide/index.html", import.meta.url), "utf8"), guideIndexHtml());
  for (const g of GUIDES) assert.equal(fs.readFileSync(new URL(`../guide/${g.slug}.html`, import.meta.url), "utf8"), guideHtml(g), g.slug);
});
