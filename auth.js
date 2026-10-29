// auth.js — 소셜 로그인 (Supabase Auth: 카카오·구글)
// 전제: supabase-config.js(window.SUPA) + @supabase/supabase-js(window.supabase) 가 먼저 로드됨.
// Supabase 대시보드에서 Kakao/Google provider 키를 설정해야 실제 로그인이 켜진다(SETUP-AUTH.md 참조).
// 키 미설정/미로드 시 조용히 버튼만 비활성 안내 → 기존 사이트 동작엔 영향 0.
(function () {
  'use strict';

  // 구형 관리자 화면이 저장했던 평문 비밀번호를 사이트 방문 즉시 폐기한다.
  try { localStorage.removeItem('af_admin_pw'); } catch (e) {}

  if (!window.SUPA || !window.SUPA.url || !window.SUPA.anon) {
    console.warn('[auth] SUPA 설정 없음 → 로그인 비활성');
    return;
  }
  if (!window.supabase || !window.supabase.createClient) {
    console.warn('[auth] supabase-js 미로드 → 로그인 비활성');
    return;
  }

  var sb = window.supabase.createClient(window.SUPA.url, window.SUPA.anon, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  // 다른 스크립트(주문 저장 등)에서 현재 사용자 참조 가능하도록 노출
  window.afAuth = { client: sb, user: null, openAccount: function () { openAccountSheet(); } };
  // 외부(결제완료 화면 등)에서 로그인/계정 시트 열기
  window.afOpenAuth = function () {
    if (window.afAuth && window.afAuth.user) openAccountSheet(); else openLoginSheet();
  };

  // 네이버 로그인 버튼 가이드(10/18 형구, 검수 대비): 배경 #03A94D, 흰 N 로고 16px 이상·글자보다 크게, 로고-글자 8px(.af-auth-btn gap).
  // N 모양은 네이버 공식 파일(NAVER_login_KR.ai)에서 그대로 옮긴 것 — 비율·모양 바꾸지 말 것.
  var NAVER_N = '<svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" style="flex:0 0 auto;display:block"><path fill="#fff" d="M13.561 10.706L6.146 0L0 0L0 20L6.44 20L6.44 9.298L13.855 20L20 20L20 0L13.561 0Z"/></svg>';
  var ENABLED_PROVIDERS = [
    { id: 'kakao', label: '카카오로 시작하기', bg: '#FEE500', fg: '#191600' },
    { id: 'naver', label: '네이버로 시작하기', bg: '#03A94D', fg: '#ffffff', icon: NAVER_N, custom: true },
    { id: 'google', label: 'Google로 시작하기', bg: '#ffffff', fg: '#1f1d18', border: '#dcd9cf' },
    { id: 'apple', label: 'Apple로 시작하기', bg: '#000000', fg: '#ffffff' }
    // 네이버=Supabase 미지원이라 백엔드 OAuth(api/naver-*) + 매직링크로 처리(custom). 애플=Apple Developer($99) 후 Supabase 설정.
  ];

  // 실제로 '연결된' provider만 버튼으로 노출 → 눌러도 안 되는 죽은 버튼 방지.
  // kakao/google/apple = Supabase 활성 여부(/auth/v1/settings), naver = 백엔드 env 여부(/api/naver-login?check).
  // 확인 전/실패한 항목은 그대로 노출(안전) → 절대 '버튼 0개'가 되지 않게.
  var PROVIDER_STATUS = null;
  function refreshProviderStatus() {
    var status = {};
    var jobs = [
      fetch(window.SUPA.url + '/auth/v1/settings', { headers: { apikey: window.SUPA.anon } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          var ext = j && j.external;
          if (ext) { status.kakao = !!ext.kakao; status.google = !!ext.google; status.apple = !!ext.apple; }
        }).catch(function () {}),
      fetch('/api/naver-login?check=1')
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { if (j && typeof j.configured === 'boolean') status.naver = j.configured; })
        .catch(function () {})
    ];
    return Promise.all(jobs).then(function () { PROVIDER_STATUS = status; });
  }
  // 네이버 로그인 앱이 '개발 중'(검수 전)이면 등록된 아이디만 되므로 true 로 숨긴다(10/18).
  // 검수 승인(10/19, 네이버 메일)으로 false. 관리자 화면(admin-auth.js)의 네이버 로그인은 이 값과 상관없다.
  var NAVER_REVIEW_PENDING = false;
  // 검수 신청용(10/18): 주소에 ?naver=1 을 붙여 열면 그 탭에서만 네이버 버튼을 보인다. 네이버 심사 담당자가 로그인 과정을 볼 수 있게.
  // 네이버 로그인 뒤 돌아와도 같은 탭이면 sessionStorage 로 이어진다. 손님 화면(주소에 naver=1 없음)은 그대로 숨김.
  var NAVER_REVIEW_KEY = 'af_naver_review';
  try { if (/[?&]naver=1(&|$)/.test(location.search)) sessionStorage.setItem(NAVER_REVIEW_KEY, '1'); } catch (e) {}
  function naverReviewTab() { try { return sessionStorage.getItem(NAVER_REVIEW_KEY) === '1'; } catch (e) { return false; } }
  function availableProviders() {
    var list = ENABLED_PROVIDERS.filter(function (p) {
      if (p.id === 'naver' && NAVER_REVIEW_PENDING && !naverReviewTab()) return false;
      if (!PROVIDER_STATUS) return true;          // 확인 전 → 전부 노출
      if (!(p.id in PROVIDER_STATUS)) return true; // 확인 못 한 항목 → 노출(안전)
      return PROVIDER_STATUS[p.id] === true;       // 연결 확인된 것만
    });
    return list.length ? list : ENABLED_PROVIDERS; // 방어: 하나도 없으면 전부
  }

  function injectStyles() {
    if (document.getElementById('af-auth-style')) return;
    var css = ''
      // 우측 하단 고정 — 상단 제목·버전배지와 겹침 방지. 탭바(af-nav-on)가 있으면 그 위로.
      + '.af-auth-chip{position:fixed;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:89;display:inline-flex;align-items:center;gap:6px;'
      + 'background:rgba(255,255,255,.95);border:1px solid #dcd9cf;border-radius:999px;color:#1f1d18;'
      + 'font-size:14px;font-weight:700;padding:7px 13px;cursor:pointer;'
      + 'font-family:-apple-system,"Apple SD Gothic Neo","Pretendard",sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.12);}'
      + 'body.af-nav-on .af-auth-chip{bottom:calc(70px + env(safe-area-inset-bottom,0px));}'
      + 'body.ordering .af-auth-chip{display:none;}' // 주문 진행 중엔 숨김(주문바와 충돌 방지)
      + '.af-auth-chip:active{opacity:.85;}'
      // 홈은 머리 전화번호 옆 자리(#hdrAuthSlot)에 붙는다(10/19 형구 A-2) — 떠 있던 칩이 시작 바·하단 탭과 겹쳤다.
      + '.af-auth-chip.af-auth-chip--hdr{position:static;display:block;min-height:44px;line-height:42px;padding:0 10px;max-width:120px;'
      + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-color:#c9dccd;border-radius:6px;background:#e8f1ea;color:#14311f;'
      + 'font-size:13px;font-weight:800;box-shadow:none;}'
      + '.af-auth-ov{position:fixed;inset:0;z-index:10002;background:rgba(31,29,24,.55);display:none;'
      + 'align-items:flex-end;justify-content:center;}'
      + '.af-auth-sheet{background:#fff;width:100%;max-width:480px;border-radius:16px 16px 0 0;padding:22px 20px calc(22px + env(safe-area-inset-bottom,0px));'
      + 'font-family:-apple-system,"Apple SD Gothic Neo","Pretendard",sans-serif;animation:af-up .28s cubic-bezier(.2,.8,.2,1);}'
      + '@keyframes af-up{from{transform:translateY(100%)}to{transform:translateY(0)}}'
      + '.af-auth-sheet h3{font-size:18px;font-weight:800;color:#1f1d18;margin-bottom:4px;}'
      + '.af-auth-sheet p{font-size:13px;color:#5a564d;margin-bottom:18px;}'
      + '.af-auth-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;'
      + 'border:none;border-radius:10px;font-size:16px;font-weight:700;padding:14px;margin-bottom:10px;cursor:pointer;font-family:inherit;}'
      + '.af-auth-x{display:block;width:100%;background:transparent;border:none;color:#9e9a8f;font-size:14px;padding:10px;margin-top:4px;cursor:pointer;font-family:inherit;}'
      + '.af-auth-note{font-size:12px;color:#9e9a8f;text-align:center;margin-top:6px;line-height:1.6;}'
      // 닫기 X(10/20 형구 '이거 어떻게 하지' — PC 폭에서 아래 붙은 시트가 잘리고 닫을 곳이 안 보였다)
      + '.af-auth-sheet{position:relative;}'
      + '.af-auth-close{position:absolute;top:12px;right:12px;width:40px;height:40px;border:0;border-radius:50%;background:transparent;color:#5a564d;font-size:22px;line-height:40px;cursor:pointer;}'
      + '.af-auth-close:hover{background:#f1efe9;}'
      // 넓은 화면(태블릿·PC)은 가운데 뜨는 창으로
      + '@media (min-width:600px){.af-auth-ov{align-items:center;padding:24px;}.af-auth-sheet{max-width:440px;border-radius:16px;padding:26px 24px 22px;max-height:calc(100vh - 48px);overflow:auto;animation:af-pop .2s ease-out;}}'
      + '@keyframes af-pop{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:none}}';
    var s = document.createElement('style');
    s.id = 'af-auth-style';
    s.textContent = css;
    document.head.appendChild(s);
  }

  function ensureChip() {
    injectStyles(); // 칩 생성 즉시 .af-auth-chip(font-size:14px) 적용 — 시트 열기 전 UA 기본 13.33px 방지
    var chip = document.getElementById('af-auth-chip');
    if (!chip) {
      chip = document.createElement('button');
      chip.id = 'af-auth-chip';
      chip.className = 'af-auth-chip';
      chip.type = 'button';
      var slot = document.getElementById('hdrAuthSlot');   // 홈: 머리 전화번호 옆, 그 밖의 페이지: 오른쪽 아래에 뜬다
      if (slot) { chip.className += ' af-auth-chip--hdr'; slot.appendChild(chip); }
      else document.body.appendChild(chip);
    }
    return chip;
  }

  function shortName(user) {
    var m = user.user_metadata || {};
    return m.name || m.full_name || m.nickname || (user.email ? user.email.split('@')[0] : '회원');
  }

  // ── 관리자 판별 ── 이메일을 브라우저 코드에 하드코딩하지 않는다.
  // 로그인 토큰을 서버가 검증하고 UID 우선 allowlist/역할로 판정한다. 이 값은 메뉴 표시용일
  // 뿐이며 실제 관리자 API도 매 요청 같은 서버 검증을 다시 한다.
  var ADMIN_ACCESS = null;
  function isAdmin(user) {
    return !!(user && ADMIN_ACCESS && ADMIN_ACCESS.ok);
  }
  function refreshAdminAccess(session) {
    ADMIN_ACCESS = null;
    if (!session || !session.access_token) { renderChip(null); return Promise.resolve(null); }
    return fetch('/api/admin', {
      method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
      body: JSON.stringify({ resource: 'session', action: 'check' })
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        ADMIN_ACCESS = r.ok ? { ok: true, role: d.role } : null;
        renderChip(session.user);
        if (ADMIN_ACCESS) {
          try {
            var next = sessionStorage.getItem('af_admin_return') || '';
            if (/^\/admin(?:-[a-z]+)?(?:\.html)?(?:\?.*)?$/.test(next)) {
              sessionStorage.removeItem('af_admin_return');
              location.replace(next);
            }
          } catch (_e) {}
        }
        return ADMIN_ACCESS;
      });
    }).catch(function () { ADMIN_ACCESS = null; renderChip(session.user); return null; });
  }
  function adminBlockHtml(user) {
    if (!isAdmin(user)) return '';
    var link = function (href, txt) {
      return '<a href="' + href + '" style="display:block;background:#fff;color:#111;text-align:center;border-radius:7px;font-size:14px;font-weight:700;padding:11px;margin-bottom:7px;text-decoration:none;">' + txt + '</a>';
    };
    return '<div style="background:#1f1d18;border-radius:10px;padding:13px 14px;margin-bottom:14px;">'
      + '<div style="font-size:12px;font-weight:800;color:#fff;letter-spacing:1px;margin-bottom:9px;">🔧 관리자 모드</div>'
      + link('/admin-orders.html', '📋 주문 관리 (들어온 주문·배송완료)')
      + link('/admin-products.html', '📦 상품 관리 (설명·사진·품절)')
      + link('/admin-home.html', '🏠 홈 화면 (첫 화면 리뷰사진)')
      + link('/admin.html', '🖼️ 갤러리 사진 올리기')
      + link('/admin-order.html', '📷 배송완료 사진 보내기')
      + link('/admin-sent.html', '🌸 보낸 꽃 사진 (텔레그램 사진 공개)')
      + link('/admin-partner.html', '🤝 파트너 QR (장례식장·예식장)')
      + '<div style="font-size:11px;color:#b9b4a8;margin-top:2px;text-align:center;">로그인 계정의 관리자 권한으로 안전하게 열어요.</div>'
      + '</div>';
  }

  function renderChip(user) {
    var chip = ensureChip();
    if (user) {
      chip.textContent = (isAdmin(user) ? '🔧 ' : '🌸 ') + shortName(user);
      chip.onclick = openAccountSheet;
    } else {
      // 혜택(가입 2,000원 적립·기념일 알림 — 10/5 아버지 결정으로 1,000→2,000)은 이미 라이브인데 칩이 그냥 '로그인'이라 아무도 몰랐다.
      // 이득을 버튼에 바로 노출 → 가입 유인. 누르면 기존 로그인 모달이 나머지 혜택을 설명.
      chip.textContent = '🎁 가입 2,000원';
      chip.onclick = openLoginSheet;
    }
    // 페이지(홈 재주문 배너 등)가 로그인 상태 변화에 반응할 수 있게 알림
    try { document.dispatchEvent(new CustomEvent('af-auth-change', { detail: { user: user } })); } catch (e) {}
  }

  function overlay() {
    var ov = document.getElementById('af-auth-ov');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'af-auth-ov';
      ov.className = 'af-auth-ov';
      document.body.appendChild(ov);
      ov.addEventListener('click', function (e) { if (e.target === ov) ov.style.display = 'none'; });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && ov.style.display === 'flex') ov.style.display = 'none'; });
    }
    return ov;
  }

  function openLoginSheet() {
    injectStyles();
    var ov = overlay();
    var btns = availableProviders().map(function (p) {
      var style = 'background:' + p.bg + ';color:' + p.fg + ';' + (p.border ? 'border:1px solid ' + p.border + ';' : '');
      return '<button class="af-auth-btn" style="' + style + '" data-prov="' + p.id + '">' + (p.icon || '') + p.label + '</button>';
    }).join('');
    ov.innerHTML =
      '<div class="af-auth-sheet">'
      + '<h3>로그인 / 회원가입</h3>'
      + '<div style="background:#e8f1ea;border:1px solid #1f4733;border-radius:8px;padding:9px 12px;margin-bottom:10px;font-size:13px;color:#14311f;font-weight:700;">가입하면 바로 2,000원 적립 · 다음 주문에 현금처럼</div>'
      + '<p>한 번 로그인하면 지난 주문을 그대로 다시 보내고, 가족 기념일을 일주일 전에 알려드려요.</p>'
      + btns
      + '<button class="af-auth-x">닫기</button>'
      + '<div class="af-auth-note">로그인 시 이용약관·개인정보 처리방침에 동의하게 됩니다.</div>'
      + '</div>';
    ov.style.display = 'flex';
    ov.querySelectorAll('.af-auth-btn').forEach(function (b) {
      b.onclick = function () { login(b.getAttribute('data-prov')); };
    });
    ov.querySelector('.af-auth-x').onclick = function () { ov.style.display = 'none'; };
  }

  // 구매하기 → 로그인 또는 비회원 → 주문서(10/18 형구). 주문서는 뒤에 이미 그려져 있고 이 시트가 위에 뜬다.
  // 로그인하면 소셜 창을 다녀오면서 주소의 ?pc= 가 사라지니, 떠나기 전 주문 주소를 저장해 두고 돌아오면 다시 연다(resumeOrder).
  // 비회원은 이 탭에서 한 번 고르면 다시 묻지 않는다.
  var ORDER_RESUME_KEY = 'af_order_resume', ORDER_GUEST_KEY = 'af_order_guest';
  var sessionKnown = false, gateWaiting = window.AF_PENDING_GATE || null;
  window.afOrderGate = function (label, resume) {
    if (!sessionKnown) { gateWaiting = [label, resume]; return; }
    if (window.afAuth.user) return;
    try { if (sessionStorage.getItem(ORDER_GUEST_KEY) === '1') return; } catch (e) {}
    openOrderGate(label, resume);
  };
  function openOrderGate(label, resume) {
    injectStyles();
    var ov = overlay();
    var btns = availableProviders().map(function (p) {
      var style = 'background:' + p.bg + ';color:' + p.fg + ';' + (p.border ? 'border:1px solid ' + p.border + ';' : '');
      return '<button class="af-auth-btn" style="' + style + '" data-prov="' + p.id + '">' + (p.icon || '') + p.label.replace('시작하기', '계속하기') + '</button>';
    }).join('');
    ov.innerHTML =
      '<div class="af-auth-sheet" role="dialog" aria-modal="true" aria-label="주문하기 전에">'
      + '<button type="button" class="af-auth-close" aria-label="닫기">×</button>'
      + '<h3>주문하기 전에</h3>'
      + (label ? '<div style="background:#f6f4ee;border:1px solid #e3dfd4;border-radius:8px;padding:9px 12px;margin-bottom:10px;font-size:13px;color:#2a2a24;">' + label + '</div>' : '')
      + '<p>로그인하면 2,000원 적립되고, 다음엔 지난 주문 그대로 다시 보낼 수 있어요.</p>'
      + btns
      + '<button class="af-auth-btn af-order-guest" style="background:#1f4733;color:#fff;margin-top:12px;">비회원으로 주문하기</button>'
      + '<div class="af-auth-note">로그인 없이도 주문할 수 있어요. 주문 확인은 연락처로 해요.</div>'
      + '</div>';
    ov.style.display = 'flex';
    // 닫기 = 바깥 누르기와 같다(주문서는 뒤에 그대로 있다)
    ov.querySelector('.af-auth-close').onclick = function () { ov.style.display = 'none'; };
    ov.querySelectorAll('.af-auth-btn[data-prov]').forEach(function (b) {
      b.onclick = function () {
        try { if (resume) sessionStorage.setItem(ORDER_RESUME_KEY, resume); } catch (e) {}
        login(b.getAttribute('data-prov'));
      };
    });
    ov.querySelector('.af-order-guest').onclick = function () {
      try { sessionStorage.setItem(ORDER_GUEST_KEY, '1'); } catch (e) {}
      ov.style.display = 'none';
      try { window.dispatchEvent(new Event('af-order-gate')); } catch (e) {}
    };
  }
  function resumeOrder(user) {
    if (!user) return;
    var r = null;
    try { r = sessionStorage.getItem(ORDER_RESUME_KEY); if (r) sessionStorage.removeItem(ORDER_RESUME_KEY); } catch (e) {}
    if (r && /^\?[\w=&%.+,\-]+$/.test(r) && location.pathname === '/' && !location.search) location.replace('/' + r);
  }
  function flushGate() {
    sessionKnown = true;
    if (gateWaiting) { var g = gateWaiting; gateWaiting = null; window.afOrderGate(g[0], g[1]); }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  // ── 웹푸시 구독 (기념일 D-7 알림 수신) ── VAPID public 은 공개값(안전) ──
  var VAPID_PUBLIC = 'BK4frAB9SMwq4pDiMapQf0uPlZG2nbfPbMR1qxiKs9JT5w5SVvre6dzkrW2NRJT9SWnVs1JE-UtEZ_24usKxFBE';
  function urlB64ToUint8(b64) {
    var pad = '='.repeat((4 - b64.length % 4) % 4);
    var s = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(s), arr = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }
  function subscribePush() {
    var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
    var isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (isIos && !standalone) { alert('아이폰은 먼저 ‘홈 화면에 추가’로 앱을 설치한 뒤, 앱에서 알림을 켜주세요.'); return; }
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) { alert('이 기기는 푸시 알림을 지원하지 않아요.'); return; }
    Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') { alert('알림이 꺼져 있어요. 브라우저/기기 설정에서 알림을 허용해주세요.'); return; }
      navigator.serviceWorker.ready.then(function (reg) {
        return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(VAPID_PUBLIC) });
      }).then(function (sub) {
        var j = sub.toJSON();
        var u = window.afAuth.user; if (!u) { alert('로그인이 필요해요.'); return; }
        return sb.from('push_subscriptions').upsert({ user_id: u.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: 'endpoint' });
      }).then(function (r) {
        if (r && r.error) { alert('알림 저장 실패: ' + r.error.message); return; }
        alert('알림을 켰어요! 등록한 기념일 7일 전에 알려드릴게요. 🌸');
      }).catch(function (e) { alert('알림 설정 실패: ' + (e && e.message || '')); });
    });
  }

  // 계정 시트를 '내 정보' 페이지(/my, my.html)로 옮겼다(10/20 형구 A안). 주문·배송, 챙길 사람(기념일), 내 안내장, 적립금이 한 곳.
  // 칩·하단 탭·?reorder=1 이 모두 여기로 온다. 이미 /my 면 맨 위로만.
  function isMyPage() { return /^\/my(\.html)?\/?$/.test(location.pathname); }
  function openAccountSheet() {
    var ov = document.getElementById('af-auth-ov'); if (ov) ov.style.display = 'none';
    if (isMyPage()) { window.scrollTo(0, 0); return; }
    location.href = '/my';
  }
  // my.html 이 쓰는 것
  window.afAuth.login = function () { openLoginSheet(); };
  window.afAuth.logout = function () { logout(); };
  window.afAuth.name = function (u) { return shortName(u || window.afAuth.user); };
  window.afAuth.adminHtml = function () { return adminBlockHtml(window.afAuth.user); };
  window.afAuth.pushOn = function () { subscribePush(); };

  // ── 돌아온 로그인 오류 보여주기(10/7) ──
  // 카카오·구글·애플·네이버(매직링크) 어느 쪽이든 실패하면 Supabase 가 #error=…&error_description=… 을 붙여 돌려보내는데,
  // 여태 아무 안내가 없어서 '로그인 버튼이 안 먹는다'로만 보였다. 이유를 보여 주고(쉬운 말 + 원문) 사장님 텔레그램에도 알린다.
  var LOGIN_TRY_KEY = 'af_login_try';
  var PROVIDER_NAMES = { kakao: '카카오', naver: '네이버', google: '구글', apple: '애플' };
  function rememberTry(provider) {
    try { sessionStorage.setItem(LOGIN_TRY_KEY, JSON.stringify({ p: provider, t: Date.now() })); } catch (e) {}
  }
  function lastTry() {
    try {
      var v = JSON.parse(sessionStorage.getItem(LOGIN_TRY_KEY) || 'null');
      sessionStorage.removeItem(LOGIN_TRY_KEY);
      return v && (Date.now() - v.t) < 30 * 60000 ? v : null;
    } catch (e) { return null; }
  }
  function explainAuthError(provider, code, desc) {
    var d = String(desc || '').toLowerCase();
    // 네이버 콜백이 붙여 보내는 코드(10/18, api/naver-callback.js)
    if (code === 'naver_state') return '네이버 로그인 창이 다른 브라우저에서 돌아와 확인하지 못했어요. 지금 이 화면에서 네이버 로그인을 한 번 더 눌러 주세요.';
    if (code === 'naver_no_email') return '네이버에서 이메일을 받지 못했어요. 네이버 로그인 때 이메일 제공에 동의해 주시거나 다른 방법으로 로그인해 주세요.';
    if (/^naver_/.test(code) && /not.*(registered|member)|미등록|등록되지/.test(d)) return '네이버 로그인이 아직 심사 전이라 등록된 계정만 로그인돼요. 다른 방법으로 로그인해 주세요.';
    if (code === 'otp_expired' || /expired/.test(d)) return '로그인 링크가 만료됐어요. 한 번 더 눌러 주세요.';
    if (/email/.test(d) && /external provider|not provided|getting user email/.test(d)) return (PROVIDER_NAMES[provider] || '로그인 계정') + '에서 이메일을 받지 못해 계정을 만들지 못했어요. 다른 방법(네이버·구글)으로 로그인해 주세요.';
    if (/verification|not completed|unverified|blocked|not verified/.test(d)) return (PROVIDER_NAMES[provider] || '이') + ' 로그인 앱이 아직 테스트(심사 전) 상태라 등록된 계정만 로그인돼요. 다른 방법으로 로그인해 주세요.';
    if (code === 'access_denied' || /denied|cancel/.test(d)) return '로그인이 중간에 취소됐어요. 다시 시도해 주세요.';
    if (/signups? not allowed/.test(d)) return '지금은 새 가입을 받지 않고 있어요.';
    if (/already (registered|exists|linked)/.test(d)) return '같은 이메일로 다른 방법으로 가입된 계정이 있어요. 처음 가입한 방법으로 로그인해 주세요.';
    return '로그인 서비스에서 오류가 돌아왔어요. 다른 방법으로 로그인해 보시고, 계속 안 되면 1577-2286 으로 알려 주세요.';
  }
  function showAuthError(provider, code, desc) {
    injectStyles();
    var ov = overlay();
    ov.innerHTML =
      '<div class="af-auth-sheet">'
      + '<h3>' + (PROVIDER_NAMES[provider] ? PROVIDER_NAMES[provider] + ' ' : '') + '로그인이 안 됐어요</h3>'
      + '<p>' + esc(explainAuthError(provider, code, desc)) + '</p>'
      + (code || desc ? '<div style="font-size:12px;color:#9e9a8f;background:#f7f4ee;border-radius:8px;padding:8px 10px;margin:-8px 0 14px;word-break:break-all;">' + esc([code, desc].filter(Boolean).join(' · ')) + '</div>' : '')
      + '<button class="af-auth-btn" style="background:#1f4733;color:#fff;" data-retry="1">다른 방법으로 로그인</button>'
      + '<button class="af-auth-x">닫기</button>'
      + '</div>';
    ov.style.display = 'flex';
    ov.querySelector('[data-retry]').onclick = function () { openLoginSheet(); };
    ov.querySelector('.af-auth-x').onclick = function () { ov.style.display = 'none'; };
  }
  function handleReturnError() {
    var src = '';
    if (/(^#|[&#])(error|error_code|error_description)=/.test(location.hash)) src = location.hash.slice(1);
    else if (/[?&](error|error_code|error_description)=/.test(location.search)) src = location.search.slice(1);
    if (!src) return false;
    var q = {};
    src.split('&').forEach(function (kv) {
      var i = kv.indexOf('='), k = i < 0 ? kv : kv.slice(0, i);
      try { q[k] = decodeURIComponent((i < 0 ? '' : kv.slice(i + 1)).replace(/\+/g, ' ')); } catch (e) { q[k] = ''; }
    });
    if (!q.error && !q.error_code && !q.error_description) return false;
    var tried = lastTry();
    var code = q.error_code || q.error || '';
    var provider = tried ? tried.p : (/^naver_/.test(code) ? 'naver' : '');
    var desc = q.error_description || '';
    // 주소에서 오류 꼬리를 떼서 새로고침·공유 때 또 안 뜨게
    try {
      var qs = location.search.replace(/([?&])(error|error_code|error_description)=[^&]*&?/g, '$1').replace(/[?&]$/, '');
      history.replaceState(null, '', location.pathname + qs);
    } catch (e) {}
    showAuthError(provider, code, desc);
    try {
      fetch('/api/order-meta', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'auth-error', provider: provider, error: q.error || '', code: q.error_code || '', description: desc.slice(0, 300), page: location.pathname })
      }).catch(function () {});
    } catch (e) {}
    return true;
  }

  // 카톡·인스타 등 앱 안 브라우저(10/18) — 구글은 여기서 로그인을 막는다(403 disallowed_useragent, 구글 화면이라 우리는 모른다).
  // 손님 대부분이 카톡 링크로 들어오니, 구글은 바깥 브라우저로 열어 준다.
  var INAPP_RE = /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|FB_IAB|Line\/|DaumApps|everytimeApp|; wv\)/i;
  function openOutside() {
    var url = location.href;
    var ua = navigator.userAgent || '';
    if (/KAKAOTALK/i.test(ua)) { location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(url); return true; }
    if (/Android/i.test(ua)) { location.href = 'intent://' + url.replace(/^https?:\/\//, '') + '#Intent;scheme=https;package=com.android.chrome;end'; return true; }
    return false;
  }
  function login(provider) {
    if (provider === 'google' && INAPP_RE.test(navigator.userAgent || '')) {
      if (openOutside()) return;
      alert('이 앱 안에서는 구글 로그인이 막혀 있어요.\n오른쪽 아래(또는 위) 메뉴의 \'Safari로 열기\'를 누른 뒤 다시 로그인해 주세요.\n카카오·네이버 로그인은 여기서도 돼요.');
      return;
    }
    rememberTry(provider);
    // 네이버는 Supabase 미지원 → 백엔드 OAuth 흐름으로(매직링크로 정식 세션 발급)
    if (provider === 'naver') { location.href = '/api/naver-login?return=' + encodeURIComponent(location.pathname + location.search); return; }
    var opts = { redirectTo: location.origin + location.pathname };
    // 카카오는 이메일(account_email) 빼고 닉네임만 요청 — 비즈니스 앱 심사(사업자) 없이 로그인 가능하게.
    if (provider === 'kakao') opts.scopes = 'profile_nickname';
    sb.auth.signInWithOAuth({
      provider: provider,
      options: opts
    }).then(function (res) {
      if (res.error) {
        console.error('[auth] 로그인 실패:', res.error);
        alert('로그인을 시작하지 못했어요.\n(' + provider + ' 설정이 아직 안 됐을 수 있어요)\n\n' + (res.error.message || ''));
      }
    });
  }

  function logout() {
    sb.auth.signOut().then(function () {
      var ov = document.getElementById('af-auth-ov');
      if (ov) ov.style.display = 'none';
    });
  }

  // 어떤 provider가 실제 연결됐는지 미리 확인(모달 열기 전에 죽은 버튼 걸러내기 위함)
  refreshProviderStatus();

  // 추천 링크로 들어와 가입한 사람: 로그인되면 한 번 등록한다(가입 24시간 안만 DB 가 받는다).
  // 적립금 기능이 꺼져 있으면 묻지 않는다. 결과가 나오면(성공·이미·늦음·잘못된 코드) 다시 묻지 않는다.
  var refTried = false;
  function claimReferral(user) {
    if (!user || refTried) return;
    var r = null;
    try { r = JSON.parse(localStorage.getItem('af_ref') || 'null'); } catch (e) {}
    if (!r || !r.c || !r.t || Date.now() - r.t > 30 * 86400000) return;
    refTried = true;
    fetch('/api/confirm-payment?config=1', { cache: 'no-store' }).then(function (x) { return x.ok ? x.json() : null; })
      .then(function (c) {
        var m = c && c.points && c.points.mode;
        var test = false; try { test = localStorage.getItem('af_points_test') === '1'; } catch (e) {}
        if (m !== 'on' && !(m === 'owner' && test)) return;
        return sb.rpc('claim_referral', { p_code: r.c }).then(function (res) {
          var v = res && res.data;
          if (v && v !== 'login') { try { localStorage.removeItem('af_ref'); } catch (e) {} }
        });
      }).catch(function () { refTried = false; });
  }

  // 초기 세션 + 변화 감지
  sb.auth.getSession().then(function (res) {
    var session = res.data.session;
    var user = session ? session.user : null;
    window.afAuth.user = user;
    renderChip(user);
    refreshAdminAccess(session);
    resumeOrder(user);
    flushGate();
    claimReferral(user);
  });
  sb.auth.onAuthStateChange(function (_event, session) {
    var user = session ? session.user : null;
    if (user) { try { sessionStorage.removeItem(LOGIN_TRY_KEY); } catch (e) {} }
    window.afAuth.user = user;
    renderChip(user);
    refreshAdminAccess(session);
    resumeOrder(user);
    claimReferral(user);
    try { window.dispatchEvent(new Event('af-order-gate')); } catch (e) {}
    if (user) { var gov = document.getElementById('af-auth-ov'); if (gov && gov.querySelector('.af-order-guest')) gov.style.display = 'none'; }
  });

  // 안전: DOM 준비 전이면 칩만 미리
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { renderChip(window.afAuth.user); handleReturnError(); });
  } else {
    renderChip(window.afAuth.user);
    handleReturnError();
  }
  window.addEventListener('hashchange', function () { handleReturnError(); });
})();
