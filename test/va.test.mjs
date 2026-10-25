// 방문 집계(va.js) 시험. ① 토큰·전화가 실린 쿼리는 Vercel 로 안 나가는지 ② 관리자·배송기사·부고장 열람은 안 세는지
// ③ ?va=0 기기는 안 세는지 ④ 붙일 화면엔 붙고 뺄 화면엔 없는지를 본다.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = fs.readFileSync(path.join(ROOT, "va.js"), "utf8");

function load(search = "", store = {}) {
  const appended = [];
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  const window = {};
  const ctx = {
    window, localStorage, URL, URLSearchParams,
    location: { search },
    document: { createElement: () => ({}), head: { appendChild: (el) => appended.push(el) } },
  };
  vm.runInNewContext(SRC, ctx);
  const hook = window.vaq.find((a) => a[0] === "beforeSend")[1];
  const send = (url) => { const out = hook({ type: "pageview", url }); return out ? out.url : null; };
  return { send, appended, store, window };
}

const O = "https://floweranbu.co.kr";

test("Vercel 스크립트를 한 번 붙이고 beforeSend 를 건다", () => {
  const { appended, window } = load();
  assert.equal(appended.length, 1);
  assert.equal(appended[0].src, "/_vercel/insights/script.js");
  assert.equal(appended[0].defer, true);
  assert.equal(typeof window.va, "function");
});

test("쿼리는 utm·상품 칸만 남기고 나머지는 지운다", () => {
  const { send } = load();
  assert.equal(send(`${O}/?utm_source=domain&utm_medium=49000kr&t=SECRET&phone=01012345678#x`), `${O}/?utm_source=domain&utm_medium=49000kr`);
  assert.equal(send(`${O}/catalog.html?item=WC-01&ref=AB12CD`), `${O}/catalog.html?item=WC-01`);
  assert.equal(send(`${O}/ask?t=abcdef0123456789`), `${O}/ask`);
  assert.equal(send(`${O}/pay.html?code=PAYTOKEN`), `${O}/pay.html`);
  assert.equal(send(`${O}/funeral/Sh수협장례식장`), `${O}/funeral/Sh수협장례식장`);
  assert.equal(send(`${O}/card-make.html?k=f`), `${O}/card-make.html`);
});

test("관리자·배송기사·도착 사진·부고장 열람은 안 센다", () => {
  const { send } = load();
  for (const p of ["/admin.html", "/admin-orders.html", "/admin", "/deliver.html?t=x", "/delivery-photo.html?o=1", "/c/AbC123", "/card.html#id", "/offline.html", "/og_card.html"]) {
    assert.equal(send(O + p), null, p);
  }
  assert.equal(send("주소 아님"), null);
});

test("?va=0 을 연 기기는 안 세고, ?va=1 로 되돌린다", () => {
  const store = {};
  assert.equal(load("?va=0", store).send(`${O}/`), null);
  assert.equal(store.af_va_off, "1");
  assert.equal(load("", store).send(`${O}/`), null);
  assert.equal(load("?va=1", store).send(`${O}/`), `${O}/`);
  assert.equal(store.af_va_off, undefined);
  assert.equal(load("?va=10", {}).send(`${O}/`), `${O}/`);
});

test("관리자 화면을 연 기기는 admin-auth.js 가 집계를 끈다", () => {
  assert.match(fs.readFileSync(path.join(ROOT, "admin-auth.js"), "utf8"), /localStorage\.setItem\("af_va_off", "1"\)/);
});

const has = (f) => fs.readFileSync(path.join(ROOT, f), "utf8").includes('src="/va.js');

test("손님 화면과 장례식장 페이지엔 붙고, 뺄 화면엔 없다", () => {
  for (const f of ["index.html", "catalog.html", "corp.html", "my.html", "pay.html", "privacy.html", "quote.html", "terms.html", "wedding.html", "bugo.html", "wedding-card.html", "card-make.html", "ask.html"]) {
    assert.ok(has(f), `${f} 에 va.js 없음`);
  }
  const admin = fs.readdirSync(ROOT).filter((f) => /^admin.*\.html$/.test(f));
  for (const f of [...admin, "deliver.html", "delivery-photo.html", "card.html", "offline.html"]) {
    assert.ok(!has(f), `${f} 에 va.js 가 붙음`);
  }
  const funeral = fs.readdirSync(path.join(ROOT, "funeral")).filter((f) => f.endsWith(".html"));
  assert.ok(funeral.length > 1000);
  const missing = funeral.filter((f) => !has(path.join("funeral", f)));
  assert.deepEqual(missing, []);
  assert.match(fs.readFileSync(path.join(ROOT, "scripts/build-funeral-pages.mjs"), "utf8"), /src="\/va\.js/);
});
