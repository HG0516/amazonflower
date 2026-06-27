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

-- 끝. 확인: 로그인 후 본인 user_id 의 주문만 select 됨.
