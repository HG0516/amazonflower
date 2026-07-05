-- =====================================================================
--  꽃안부 2차 개발 — Supabase 스키마 + RLS (주문 플로우 + 회원 체계)
--  Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 RUN 하세요. (한 번만)
--  ★ 전부 멱등(여러 번 실행해도 안전) + additive(기존 컬럼·데이터·동작 절대 안 건드림).
--    기존 라이브 결제/주문저장(api/confirm-payment.js)·마감알림(check-deadlines)은
--    예전 컬럼(amount, sender_name, event_date, status='new' …)을 그대로 계속 씀.
--    이 파일은 "새 칸"과 "새 표"만 추가한다.
-- =====================================================================


-- ─────────────────────────────────────────────────────────────────────
--  1) orders — 2차 주문서용 새 칸 추가 (전부 nullable, 기존 행/코드 영향 0)
--     * 예전 칸은 그대로 두고, 새 주문 플로우가 아래 새 칸을 채운다.
--     * status 는 일부러 안 건드림 — 기존 check-deadlines 가 status='new' 를 쓰기 때문.
--       6단계(접수/제작중/사진발송/배송중/완료/취소) 전환은 결제·상태머신 개편 때 함께 진행.
-- ─────────────────────────────────────────────────────────────────────
alter table public.orders add column if not exists price              int;      -- 상품 정가(할인 전)
alter table public.orders add column if not exists discount_points    int not null default 0;  -- 사용한 포인트(원)
alter table public.orders add column if not exists paid_amount        int;      -- 실제 결제금액(= price + 옵션 - 포인트)

alter table public.orders add column if not exists recipient_phone    text;     -- ★받는 분 연락처(예전엔 없었음)
alter table public.orders add column if not exists zip_code           text;     -- 우편번호
alter table public.orders add column if not exists road_address       text;     -- 도로명주소
alter table public.orders add column if not exists detail_address     text;     -- 상세주소(동·호)
alter table public.orders add column if not exists building_name      text;     -- 건물명(숨김 저장)
alter table public.orders add column if not exists room_info          text;     -- 근조 빈소 호실

alter table public.orders add column if not exists delivery_date      date;     -- 배송일
alter table public.orders add column if not exists delivery_time_slot text;     -- 배송 시간대

alter table public.orders add column if not exists ribbon_text        text;     -- 리본 문구
alter table public.orders add column if not exists ribbon_sender      text;     -- 리본 보내는분 표기명

alter table public.orders add column if not exists orderer_name       text;     -- 주문자 성함
alter table public.orders add column if not exists orderer_phone      text;     -- 주문자 연락처
alter table public.orders add column if not exists orderer_email      text;     -- 주문자 이메일(선택)
alter table public.orders add column if not exists request_note       text;     -- 요청사항

-- 비회원 주문조회(/order-lookup)·재조회 성능용 인덱스
create index if not exists orders_order_id_idx        on public.orders(order_id);
create index if not exists orders_recipient_phone_idx on public.orders(recipient_phone);
create index if not exists orders_orderer_phone_idx   on public.orders(orderer_phone);

-- 참고: product_id 는 새로 만들지 않는다. 기존 product_code(text, 예 'congrats_g1')가 곧 상품 식별자다.


-- ─────────────────────────────────────────────────────────────────────
--  2) profiles — 회원 프로필 + 사업자 정보 (auth.users 1:1)
--     가입 시 아래 트리거가 자동 생성. 본인만 조회·수정(RLS).
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  name        text,
  phone       text,
  biz_name    text,            -- 상호(선택)
  biz_reg_no  text,            -- 사업자등록번호(선택)
  biz_email   text,            -- 세금계산서 이메일(선택)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ─────────────────────────────────────────────────────────────────────
--  3) saved_addresses — 회원 저장 배송지 (주문서에서 빠른 선택)
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.saved_addresses (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  label          text,          -- 예: "회사", "부모님댁"
  zip_code       text,
  road_address   text,
  detail_address text,
  created_at     timestamptz not null default now()
);
create index if not exists saved_addresses_user_idx on public.saved_addresses(user_id);
alter table public.saved_addresses enable row level security;
drop policy if exists "own addresses" on public.saved_addresses;
create policy "own addresses" on public.saved_addresses
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ─────────────────────────────────────────────────────────────────────
--  4) saved_ribbons — 회원 저장 리본문구 (자주 쓰는 문구·보내는분 표기명)
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.saved_ribbons (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  text         text not null,   -- 리본 문구
  sender_name  text,            -- 보내는분 표기명
  created_at   timestamptz not null default now()
);
create index if not exists saved_ribbons_user_idx on public.saved_ribbons(user_id);
alter table public.saved_ribbons enable row level security;
drop policy if exists "own ribbons" on public.saved_ribbons;
create policy "own ribbons" on public.saved_ribbons
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ─────────────────────────────────────────────────────────────────────
--  5) points_ledger — 포인트 원장 (등급제·유효기간 없음. 잔액 = 합산)
--     * 적립/사용은 서버(service_role)와 가입 트리거만 기록 → 회원은 '조회'만 가능(RLS).
--       (회원이 직접 insert 로 포인트를 만들 수 없게 함 = 보안)
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.points_ledger (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  amount     int  not null,               -- +적립 / -사용
  reason     text not null check (reason in ('가입','리뷰','사용','관리자조정')),
  order_id   text,                          -- 관련 주문(토스 orderId), 없으면 null
  created_at timestamptz not null default now()
);
create index if not exists points_ledger_user_idx on public.points_ledger(user_id);
alter table public.points_ledger enable row level security;
drop policy if exists "read own points" on public.points_ledger;
create policy "read own points" on public.points_ledger
  for select using (auth.uid() = user_id);

-- 잔액 뷰 — ledger 합산. security_invoker 로 조회자의 RLS(본인 것만)를 그대로 적용.
create or replace view public.points_balance
  with (security_invoker = on) as
  select user_id, coalesce(sum(amount), 0)::int as balance
  from public.points_ledger
  group by user_id;


-- ─────────────────────────────────────────────────────────────────────
--  6) url_parse_logs — URL 자동기입 파싱 로그 (도메인·성공여부만. 개인정보 저장 안 함)
--     * 어떤 청첩장/부고 도메인이 많이 들어오는지 집계 → 정적 파서 우선순위 결정용.
--     * 서버(service_role)만 기록·조회. 공개 정책 없음(RLS enable + 정책 미부여 = 서버 전용).
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.url_parse_logs (
  id         uuid primary key default gen_random_uuid(),
  domain     text,                          -- 예: 'mcard.co.kr' (전체 URL·본문은 저장 안 함)
  success    boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists url_parse_logs_domain_idx on public.url_parse_logs(domain);
alter table public.url_parse_logs enable row level security;
-- (정책 없음 → anon/authenticated 는 접근 불가, service_role 서버 함수만 기록)


-- ─────────────────────────────────────────────────────────────────────
--  7) 가입 인센티브 — 신규 회원 가입 즉시 프로필 생성 + 1,000P 자동 적립
--     * 카카오·네이버(관리자 API 생성 포함) 모두 auth.users 에 들어오므로 공통 적용.
--     * ★안전장치: 어떤 오류가 나도 예외를 삼켜서 '가입/로그인 자체는 절대 안 막는다'.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 프로필 자동 생성 (이름은 소셜 메타데이터에서 최대한 끌어옴)
  insert into public.profiles (user_id, name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'name',
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'nickname'
    )
  )
  on conflict (user_id) do nothing;

  -- 가입 축하 1,000P (이 유저에게 '가입' 적립이 아직 없을 때만 — 중복 방지)
  if not exists (
    select 1 from public.points_ledger
    where user_id = new.id and reason = '가입'
  ) then
    insert into public.points_ledger (user_id, amount, reason)
    values (new.id, 1000, '가입');
  end if;

  return new;
exception when others then
  -- 포인트/프로필이 실패해도 회원가입은 성공해야 한다.
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ─────────────────────────────────────────────────────────────────────
--  8) (선택) 이미 가입돼 있는 기존 회원에게도 소급 1,000P 지급
--     — '가입' 적립 이력이 없는 유저 전원에게 1회 지급. 여러 번 실행해도 중복 안 됨.
-- ─────────────────────────────────────────────────────────────────────
insert into public.points_ledger (user_id, amount, reason)
select u.id, 1000, '가입'
from auth.users u
where not exists (
  select 1 from public.points_ledger p
  where p.user_id = u.id and p.reason = '가입'
);

-- 기존 회원 프로필도 소급 생성(없는 경우만)
insert into public.profiles (user_id, name)
select u.id, coalesce(u.raw_user_meta_data->>'name', u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'nickname')
from auth.users u
on conflict (user_id) do nothing;


-- =====================================================================
--  끝. 확인:
--   select * from public.points_balance;                 -- 회원별 잔액
--   select column_name from information_schema.columns    -- orders 새 칸 확인
--     where table_name='orders' order by ordinal_position;
--  참고: anniversaries / push_subscriptions 는 이미 supabase-auth.sql 로 존재(재생성 불필요).
-- =====================================================================
