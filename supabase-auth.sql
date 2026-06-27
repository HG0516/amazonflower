-- 로그인 사용자 ↔ 주문 연결 (내 주문 / 원탭 재주문의 토대)
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 RUN 하세요. (한 번만, 안전·멱등)

-- 1) orders 에 user_id 추가 — 로그인하고 주문하면 이 칸에 사용자가 기록된다.
--    (비회원 주문은 null 그대로 → 기존 동작 영향 없음)
alter table public.orders
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists orders_user_id_idx on public.orders(user_id);

-- 2) RLS: 로그인 사용자는 '내 주문'만 조회 가능.
--    주문 저장(insert)·마감체크는 서버 함수가 service_role 키로 하므로 RLS를 우회한다 → 영향 없음.
--    (orders 를 anon 키로 직접 읽는 코드는 없음 → 보안만 강화됨)
alter table public.orders enable row level security;

drop policy if exists "read own orders" on public.orders;
create policy "read own orders" on public.orders
  for select using (auth.uid() = user_id);

-- 3) 발주 누락방지 — '발주 완료 처리' 시각 기록(없어도 status='ordered'로 동작, 있으면 더 정확)
alter table public.orders
  add column if not exists ordered_at timestamptz;

-- 4) 완료사진 회신 — 사장님이 배송완료 사진을 올리면 기록(고객이 '내 주문'에서 확인)
alter table public.orders
  add column if not exists completed_photo text;
alter table public.orders
  add column if not exists completed_at timestamptz;

-- 5) 완료사진 전용 '비공개' 버킷 — 배송 사진엔 주소·실명·인물이 담길 수 있어 공개 gallery 대신 사용.
--    공개 읽기 정책을 두지 않음 → service_role(서버)만 접근. 고객에겐 /api/order-photo-view 가
--    로그인 본인 확인 후 사진을 프록시로만 내려준다(URL이 새어도 타인은 못 봄).
insert into storage.buckets (id, name, public)
values ('order-photos', 'order-photos', false)
on conflict (id) do update set public = false;

-- 6) 기념일 — 회원이 등록한 반복 기념일(생일·결혼기념일·기일 등). D-7 푸시 알림의 토대.
--    연도 무관(매년 반복)이라 월(month)·일(day)만 저장. 본인만 CRUD(RLS).
create table if not exists public.anniversaries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  label       text not null,                 -- 예: "어머니 생신", "결혼기념일"
  month       int  not null check (month between 1 and 12),
  day         int  not null check (day between 1 and 31),
  recipient   text,                          -- 받는 분(선택)
  notified_on text,                          -- 올해 알림 보낸 날(YYYY-MM-DD) — 중복 푸시 방지
  created_at  timestamptz not null default now()
);
alter table public.anniversaries enable row level security;
drop policy if exists "own anniversaries" on public.anniversaries;
create policy "own anniversaries" on public.anniversaries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 끝. 확인: 로그인 후 본인 user_id 의 주문만 select 됨.
