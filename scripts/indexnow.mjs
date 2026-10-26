// scripts/indexnow.mjs
// 새로 만들거나 고친 페이지를 빙·네이버 등에 바로 알린다(IndexNow, 10/26). 챗GPT 검색은 빙 색인을 많이 쓴다.
// 열쇠 = 사이트 맨 위의 <32자리>.txt (공개 파일이 원래 규칙이라 비밀이 아니다). 지우면 알림이 거절된다.
//
// 실행: node scripts/indexnow.mjs              → sitemap.xml + sitemap-funeral.xml 의 주소 전부
//       node scripts/indexnow.mjs /prices /faq → 적은 주소만
// 배포가 끝난 뒤에 돌릴 것(로봇이 바로 와서 읽는다).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOST = "floweranbu.co.kr";
const BASE = `https://${HOST}`;

const keyFile = fs.readdirSync(ROOT).find((f) => /^[0-9a-f]{32}\.txt$/.test(f));
if (!keyFile) { console.error("열쇠 파일(<32자리>.txt)이 없어요."); process.exit(1); }
const key = fs.readFileSync(path.join(ROOT, keyFile), "utf8").trim();

const args = process.argv.slice(2);
const urls = args.length
  ? args.map((u) => (u.startsWith("http") ? u : BASE + (u.startsWith("/") ? u : "/" + u)))
  : ["sitemap.xml", "sitemap-funeral.xml"].flatMap((f) =>
      [...fs.readFileSync(path.join(ROOT, f), "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));

const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: HOST, key, keyLocation: `${BASE}/${keyFile}`, urlList: urls.slice(0, 10000) }),
});
console.log(`IndexNow ${res.status} ${res.statusText} · 주소 ${Math.min(urls.length, 10000)}개`);
if (!res.ok) { console.log(await res.text()); process.exit(1); }
