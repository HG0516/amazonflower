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

  function openAccountSheet() {
    injectStyles();
    var ov = overlay();
    var user = window.afAuth.user;
    ov.innerHTML =
      '<div class="af-auth-sheet">'
      + '<h3>' + (user ? shortName(user) : '내 계정') + '님</h3>'
      + '<p>지난 주문·재주문·기념일 알림은 곧 추가됩니다.</p>'
      + '<button class="af-auth-btn" style="background:#f3efe6;color:#1f1d18;" id="af-logout">로그아웃</button>'
      + '<button class="af-auth-x">닫기</button>'
      + '</div>';
    ov.style.display = 'flex';
    ov.querySelector('#af-logout').onclick = logout;
    ov.querySelector('.af-auth-x').onclick = function () { ov.style.display = 'none'; };
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
