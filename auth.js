// auth.js — 소셜 로그인 (Supabase Auth: 카카오·구글)
// 전제: supabase-config.js(window.SUPA) + @supabase/supabase-js(window.supabase) 가 먼저 로드됨.
// Supabase 대시보드에서 Kakao/Google provider 키를 설정해야 실제 로그인이 켜진다(SETUP-AUTH.md 참조).
// 키 미설정/미로드 시 조용히 버튼만 비활성 안내 → 기존 사이트 동작엔 영향 0.
(function () {
  'use strict';

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
  window.afAuth = { client: sb, user: null };

  var ENABLED_PROVIDERS = [
    { id: 'kakao', label: '카카오로 시작하기', bg: '#FEE500', fg: '#191600' },
    { id: 'google', label: 'Google로 시작하기', bg: '#ffffff', fg: '#1f1d18', border: '#d9d3c4' }
    // 네이버: Supabase 미지원(백엔드 커스텀 필요) — 후속. 애플: Apple Developer($99) 후 추가.
  ];

  function injectStyles() {
    if (document.getElementById('af-auth-style')) return;
    var css = ''
      + '.af-auth-chip{position:fixed;top:12px;left:12px;z-index:998;display:inline-flex;align-items:center;gap:6px;'
      + 'background:rgba(255,255,255,.95);border:1px solid #d9d3c4;border-radius:999px;color:#1f1d18;'
      + 'font-size:13px;font-weight:700;padding:7px 13px;cursor:pointer;'
      + 'font-family:-apple-system,"Apple SD Gothic Neo","Pretendard",sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.08);}'
      + '.af-auth-chip:active{opacity:.85;}'
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
      + '.af-auth-note{font-size:12px;color:#9e9a8f;text-align:center;margin-top:6px;line-height:1.6;}';
    var s = document.createElement('style');
    s.id = 'af-auth-style';
    s.textContent = css;
    document.head.appendChild(s);
  }

  function ensureChip() {
    var chip = document.getElementById('af-auth-chip');
    if (!chip) {
      chip = document.createElement('button');
      chip.id = 'af-auth-chip';
      chip.className = 'af-auth-chip';
      chip.type = 'button';
      document.body.appendChild(chip);
    }
    return chip;
  }

  function shortName(user) {
    var m = user.user_metadata || {};
    return m.name || m.full_name || m.nickname || (user.email ? user.email.split('@')[0] : '회원');
  }

  function renderChip(user) {
    var chip = ensureChip();
    if (user) {
      chip.textContent = '🌸 ' + shortName(user);
      chip.onclick = openAccountSheet;
    } else {
      chip.textContent = '로그인';
      chip.onclick = openLoginSheet;
    }
  }

  function overlay() {
    var ov = document.getElementById('af-auth-ov');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'af-auth-ov';
      ov.className = 'af-auth-ov';
      document.body.appendChild(ov);
      ov.addEventListener('click', function (e) { if (e.target === ov) ov.style.display = 'none'; });
    }
    return ov;
  }

  function openLoginSheet() {
    injectStyles();
    var ov = overlay();
    var btns = ENABLED_PROVIDERS.map(function (p) {
      var style = 'background:' + p.bg + ';color:' + p.fg + ';' + (p.border ? 'border:1px solid ' + p.border + ';' : '');
      return '<button class="af-auth-btn" style="' + style + '" data-prov="' + p.id + '">' + p.label + '</button>';
    }).join('');
    ov.innerHTML =
      '<div class="af-auth-sheet">'
      + '<h3>로그인 / 회원가입</h3>'
      + '<p>한 번 로그인하면 지난 주문을 그대로 다시 보내고, 기념일 알림을 받을 수 있어요.</p>'
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

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function fmtWon(n) { return (Number(n) || 0).toLocaleString() + '원'; }

  // 내 주문 조회 (RLS로 본인 것만). created_at 컬럼이 없을 수 있어 정렬 실패 시 재시도.
  function loadMyOrders() {
    var cols = 'order_id,product_label,product_code,recipient_name,venue,address,amount,event_date,event_time,order_type,status,completed_photo,completed_at,created_at';
    var fb = 'order_id,product_label,product_code,recipient_name,venue,address,amount,event_date,event_time,order_type,status,completed_photo,completed_at';
    return sb.from('orders').select(cols).order('created_at', { ascending: false }).limit(30)
      .then(function (res) {
        if (res.error) {
          return sb.from('orders').select(fb).limit(30).then(function (r2) { return r2.data || []; });
        }
        return res.data || [];
      })
      .catch(function () { return []; });
  }

  // 원탭 재주문 — index의 afReorder로 폼 재현. 다른 페이지면 sessionStorage 후 홈으로.
  function startReorder(o) {
    var ov = document.getElementById('af-auth-ov'); if (ov) ov.style.display = 'none';
    if (typeof window.afReorder === 'function') { window.afReorder(o); }
    else {
      try { sessionStorage.setItem('af_reorder', JSON.stringify(o)); } catch (e) {}
      location.href = '/?reorder=1';
    }
  }

  // ── 기념일(D-7 알림의 토대) ── 로그인 세션 + RLS로 본인 것만 CRUD ──
  function renderAnnivSection() {
    var box = document.getElementById('af-anniv'); if (!box) return;
    var months = ''; for (var m = 1; m <= 12; m++) months += '<option value="' + m + '">' + m + '월</option>';
    var days = ''; for (var d = 1; d <= 31; d++) days += '<option value="' + d + '">' + d + '일</option>';
    box.innerHTML =
      '<div style="font-size:13px;font-weight:800;margin:10px 0 8px;">🎂 기념일 <span style="font-weight:400;font-size:11px;color:#9e9a8f;">— 일주일 전에 알려드려요</span></div>'
      + '<div id="af-anniv-list" style="margin-bottom:8px;"></div>'
      + '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:14px;">'
      + '<input id="af-anniv-label" maxlength="30" placeholder="예) 어머니 생신" style="flex:1;min-width:120px;font-size:14px;padding:9px 10px;border:1px solid #d9d3c4;border-radius:6px;font-family:inherit;"/>'
      + '<select id="af-anniv-month" style="font-size:14px;padding:9px 6px;border:1px solid #d9d3c4;border-radius:6px;font-family:inherit;">' + months + '</select>'
      + '<select id="af-anniv-day" style="font-size:14px;padding:9px 6px;border:1px solid #d9d3c4;border-radius:6px;font-family:inherit;">' + days + '</select>'
      + '<button id="af-anniv-add" style="background:#2d4a38;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:700;padding:9px 14px;cursor:pointer;font-family:inherit;">추가</button>'
      + '</div>'
      + '<button id="af-anniv-push" style="width:100%;background:#fff;color:#2d4a38;border:1px solid #2d4a38;border-radius:8px;font-size:14px;font-weight:700;padding:10px;cursor:pointer;font-family:inherit;margin-bottom:6px;">🔔 기념일 알림 켜기</button>';
    document.getElementById('af-anniv-add').onclick = addAnniv;
    document.getElementById('af-anniv-push').onclick = subscribePush;
    loadAnniv();
  }
  function loadAnniv() {
    sb.from('anniversaries').select('id,label,month,day,recipient')
      .order('month', { ascending: true }).order('day', { ascending: true })
      .then(function (res) { renderAnnivList((res && res.data) || []); })
      .catch(function () {});
  }
  function renderAnnivList(rows) {
    var el = document.getElementById('af-anniv-list'); if (!el) return;
    if (!rows.length) { el.innerHTML = '<div style="font-size:12.5px;color:#9e9a8f;">등록한 기념일이 없어요. 추가해두면 일주일 전에 알려드려요.</div>'; return; }
    el.innerHTML = rows.map(function (a) {
      return '<div style="display:flex;justify-content:space-between;align-items:center;border:1px solid #ebe6da;border-radius:8px;padding:8px 10px;margin-bottom:6px;">'
        + '<span style="font-size:13.5px;color:#1f1d18;"><b>' + a.month + '/' + a.day + '</b> · ' + esc(a.label) + (a.recipient ? ' <span style="color:#9e9a8f;">(' + esc(a.recipient) + ')</span>' : '') + '</span>'
        + '<button class="af-anniv-del" data-id="' + esc(a.id) + '" style="background:transparent;border:none;color:#9a3b2e;font-size:13px;cursor:pointer;font-family:inherit;">삭제</button>'
        + '</div>';
    }).join('');
    el.querySelectorAll('.af-anniv-del').forEach(function (b) { b.onclick = function () { delAnniv(b.getAttribute('data-id')); }; });
  }
  function addAnniv() {
    var label = (document.getElementById('af-anniv-label').value || '').trim();
    var month = parseInt(document.getElementById('af-anniv-month').value, 10);
    var day = parseInt(document.getElementById('af-anniv-day').value, 10);
    if (!label) { alert('기념일 이름을 적어주세요. (예: 어머니 생신)'); return; }
    var u = window.afAuth.user; if (!u) { alert('로그인이 필요해요.'); return; }
    sb.from('anniversaries').insert({ user_id: u.id, label: label, month: month, day: day })
      .then(function (res) {
        if (res.error) { alert('저장 실패: ' + res.error.message); return; }
        document.getElementById('af-anniv-label').value = '';
        loadAnniv();
      })
      .catch(function () { alert('저장 중 오류가 발생했어요.'); });
  }
  function delAnniv(id) {
    sb.from('anniversaries').delete().eq('id', id).then(function () { loadAnniv(); }).catch(function () {});
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

  function openAccountSheet() {
    injectStyles();
    var ov = overlay();
    var user = window.afAuth.user;
    ov.innerHTML =
      '<div class="af-auth-sheet">'
      + '<h3>' + (user ? esc(shortName(user)) : '내 계정') + '님</h3>'
      + '<div id="af-anniv"></div>'
      + '<div id="af-orders"><p style="color:#5a564d;font-size:13px;">지난 주문을 불러오는 중…</p></div>'
      + '<button class="af-auth-btn" style="background:#f3efe6;color:#1f1d18;" id="af-logout">로그아웃</button>'
      + '<button class="af-auth-x">닫기</button>'
      + '</div>';
    ov.style.display = 'flex';
    ov.querySelector('#af-logout').onclick = logout;
    ov.querySelector('.af-auth-x').onclick = function () { ov.style.display = 'none'; };

    renderAnnivSection();
    loadMyOrders().then(function (rows) {
      var box = document.getElementById('af-orders');
      if (!box) return;
      if (!rows.length) {
        box.innerHTML = '<p style="color:#5a564d;font-size:13px;margin-bottom:14px;">아직 주문 내역이 없어요. 첫 주문을 해보세요 🌸</p>';
        return;
      }
      var head = '<div style="font-size:13px;font-weight:800;color:#1f1d18;margin:8px 0;">내 주문 (' + rows.length + ')</div>';
      var list = '<div style="max-height:46vh;overflow:auto;margin-bottom:12px;">' + rows.map(function (o, i) {
        var who = [o.recipient_name, o.venue].filter(Boolean).join(' · ');
        return '<div style="border:1px solid #ebe6da;border-radius:8px;padding:10px 12px;margin-bottom:8px;">'
          + '<div style="font-size:14px;font-weight:700;color:#1f1d18;">' + esc(o.product_label || '주문') + '</div>'
          + (who ? '<div style="font-size:12.5px;color:#5a564d;margin-top:2px;">' + esc(who) + '</div>' : '')
          + (o.event_date ? '<div style="font-size:12px;color:#9e9a8f;margin-top:1px;">' + esc(o.event_date) + '</div>' : '')
          + (o.completed_photo ? '<div style="margin-top:8px;"><img data-po="' + esc(o.order_id) + '" alt="배송완료 사진" style="width:100%;border-radius:6px;display:none;"/><div style="font-size:12px;color:#2d4a38;font-weight:700;margin-top:4px;">✅ 배송완료 사진이 도착했어요</div></div>' : '')
          + '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;">'
          + '<span style="font-size:13px;font-weight:700;color:#2d4a38;">' + fmtWon(o.amount) + '</span>'
          + '<button class="af-reorder" data-i="' + i + '" style="background:#2d4a38;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:700;padding:7px 12px;cursor:pointer;">다시 주문</button>'
          + '</div></div>';
      }).join('') + '</div>';
      box.innerHTML = head + list;
      box.querySelectorAll('.af-reorder').forEach(function (b) {
        b.onclick = function () { startReorder(rows[parseInt(b.getAttribute('data-i'), 10)]); };
      });
      // 배송완료 사진은 비공개 버킷 — 본인 토큰으로 프록시 요청해 blob 으로만 표시(URL 노출 없음)
      box.querySelectorAll('img[data-po]').forEach(function (im) {
        var oid = im.getAttribute('data-po');
        sb.auth.getSession().then(function (s) {
          var tok = s && s.data && s.data.session && s.data.session.access_token;
          if (!tok) return;
          fetch('/api/order-photo-view?order=' + encodeURIComponent(oid), { headers: { Authorization: 'Bearer ' + tok } })
            .then(function (r) { return r.ok ? r.blob() : null; })
            .then(function (b) { if (b) { im.src = URL.createObjectURL(b); im.style.display = 'block'; } })
            .catch(function () {});
        });
      });
    });
  }

  function login(provider) {
    sb.auth.signInWithOAuth({
      provider: provider,
      options: { redirectTo: location.origin + location.pathname }
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

  // 초기 세션 + 변화 감지
  sb.auth.getSession().then(function (res) {
    var user = res.data.session ? res.data.session.user : null;
    window.afAuth.user = user;
    renderChip(user);
  });
  sb.auth.onAuthStateChange(function (_event, session) {
    var user = session ? session.user : null;
    window.afAuth.user = user;
    renderChip(user);
  });

  // 안전: DOM 준비 전이면 칩만 미리
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { renderChip(window.afAuth.user); });
  } else {
    renderChip(window.afAuth.user);
  }
})();
