// kakao-share.js — 버튼 달린 카톡 메시지(카카오 공유 feed). 꽃 인사·선물 링크가 같이 쓴다(11/2).
// 키는 Vercel env KAKAO_JS_KEY(공개용 JavaScript 키) → GET /api/order-meta?kakao=1. 카카오 앱에 floweranbu.co.kr 이 등록돼 있어야 한다.
// 키가 없거나 실패하면 폰 공유 창(글+링크)으로, 그것도 없으면 링크 복사로 넘어간다. 사진 파일은 보내지 않는다(링크가 이어져야 해서).
(function () {
  "use strict";
  var SDK = "https://t1.kakaocdn.net/kakao_js_sdk/2.8.3/kakao.min.js";
  var SRI = "sha384-oroumrnFVE0xtgqyDZJARgERibXg2C28380uaUZz2kHDS5CR7tu20eGiOU6GkTpy";
  var keyP = null;
  function key() {
    if (!keyP) keyP = fetch("/api/order-meta?kakao=1").then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (j) { return (j && j.kakaoKey) || ""; }).catch(function () { return ""; });
    return keyP;
  }
  function sdk(k) {
    return new Promise(function (ok, no) {
      function init() { try { if (!window.Kakao.isInitialized()) window.Kakao.init(k); ok(window.Kakao); } catch (e) { no(e); } }
      if (window.Kakao) return init();
      var sc = document.createElement("script");
      sc.src = SDK; sc.integrity = SRI; sc.crossOrigin = "anonymous";
      sc.onload = init; sc.onerror = no;
      document.head.appendChild(sc);
    });
  }
  function abs(u) { try { return new URL(u, location.origin).href; } catch (_) { return u; } }
  function copy(text) {
    return new Promise(function (ok) {
      try { navigator.clipboard.writeText(text).then(function () { ok("copied"); }, function () { prompt("이 글을 복사해 주세요", text); ok("prompt"); }); }
      catch (_) { prompt("이 글을 복사해 주세요", text); ok("prompt"); }
    });
  }
  // m = { title, desc, image, url, buttons:[{title,url}], text(공유 창용 한 줄) }
  // 돌려주는 값: "kakao" | "share" | "copied" | "prompt" | "cancel"
  function send(m) {
    var url = abs(m.url);
    function plain() {
      var text = m.text || m.title;
      if (navigator.share) {
        return navigator.share({ text: text, url: url }).then(function () { return "share"; }, function (e) {
          return e && e.name === "AbortError" ? "cancel" : copy(text + "\n" + url);
        });
      }
      return copy(text + "\n" + url);
    }
    return key().then(function (k) {
      if (!k) return plain();
      return sdk(k).then(function (K) {
        K.Share.sendDefault({
          objectType: "feed",
          content: { title: m.title, description: m.desc || "", imageUrl: abs(m.image), imageWidth: m.w || 900, imageHeight: m.h || 700, link: { mobileWebUrl: url, webUrl: url } },
          buttons: (m.buttons || []).slice(0, 2).map(function (b) { var u = abs(b.url); return { title: b.title, link: { mobileWebUrl: u, webUrl: u } }; }),
        });
        return "kakao";
      }).catch(plain);
    });
  }
  window.afKakao = { send: send, key: key, copy: copy };
})();
