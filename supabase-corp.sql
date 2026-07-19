-- supabase-corp.sql — 법인 거래처 계정(완만 게이팅) Phase 1
-- 실행: Supabase 대시보드 → SQL Editor → 붙여넣기 → Run. 전부 멱등(IF NOT EXISTS)이라 여러 번 돌려도 안전.
--
-- 배경:
--  · orders 의 corp_* 컬럼은 confirm-payment.js(쓰기)·parse-url.js/admin.js(읽기)가 참조하는데
--    이 리포엔 그 컬럼을 만드는 마이그레이션이 없었다(대시보드 수동추가 추정). 컬럼이 없으면
--    법인 주문이 결제는 되고 orders INSERT 는 400 으로 조용히 실패한다 → (1) 로 멱등 보장.
--  · corp_accounts 는 '정기 거래처 원장'. 식별키=사업자번호(숫자10). 계정 링크(tier-2)의 논스를 담아
--    유출 시 재발급으로 옛 링크를 무효화한다. 손님(anon)엔 절대 노출 금지 → RLS on + 공개정책 없음.

-- (1) orders 법인 컬럼 (이미 있으면 no-op)
alter table public.orders
  add column if not exists corp_name  text,
  add column if not exists corp_regno text,
  add column if not exists corp_email text,
  add column if not exists corp_ceo   text,
  add column if not exists corp_addr  text;

create index if not exists orders_corp_regno_idx on public.orders (corp_regno);

-- (2) 정기 거래처 원장
create table if not exists public.corp_accounts (
  regno            text primary key check (regno ~ '^[0-9]{10}$'),  -- 사업자번호(숫자10, 하이픈 제거)
  biz_name         text not null,
  contact_email    text,               -- 계산서 수신
  contact_phone    text,               -- 사장님이 링크를 보낼 채널
  ceo              text,
  addr             text,
  approved         boolean not null default false,   -- 사장님 승인(정기 거래처). Phase 2 후불 게이트로도 사용
  postpaid_allowed boolean not null default false,   -- 후불(외상) 허용 — Phase 2 에서 활성. 지금은 미사용
  postpaid_limit   integer not null default 0,       -- 신용한도(원) — Phase 2. 지금은 미사용
  token_nonce      text not null default substr(md5(random()::text), 1, 8),  -- 계정 링크 재발급용(내장함수만)
  note             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz
);

-- RLS 켜고 '공개 정책은 만들지 않는다' = anon 전면 차단, service_role(서버)만 접근.
-- ⚠️ anon 키는 커밋된 영구 공개 JWT(supabase-config.js) 라, 공개 read 정책을 두면
--    모든 거래처의 승인상태·후불한도가 전 세계에 노출된다. 손님측 노출은 오직
--    parse-url.js 의 service_role + HMAC 토큰 프록시(corpaccount/corporders)로만.
alter table public.corp_accounts enable row level security;
