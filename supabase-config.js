// Supabase 공개 설정 — 카탈로그가 "보유 종류" 라이브 사진을 읽어올 때 사용.
// anon(public) 키는 공개돼도 안전합니다 (RLS로 '보이는 것만 읽기'로 제한). 서비스키는 절대 여기 넣지 마세요(서버 전용).
// Supabase 프로젝트를 만든 뒤 아래 두 값을 채우면 됩니다. 비워두면 라이브 사진 없이 기본 갤러리만 표시됩니다.
window.SUPA = {
  url: "",   // 예: https://abcdxxxx.supabase.co
  anon: ""   // anon public 키 (Supabase → Project Settings → API)
};
