-- supabase-corp.sql — (선택) 안전 점검용. 실행 안 해도 '거래처 계정' 기능은 동작한다.
--
-- 거래처 계정(주문내역 대시보드)은 기존 corp 링크 토큰(corp:regno)을 그대로 재사용하므로
-- 새 테이블·마이그레이션이 필요 없다. 이 파일은 만일의 컬럼 누락(법인 주문이 결제는 되는데
-- orders 저장이 조용히 실패하는 위험)을 닫는 멱등 마이그레이션일 뿐 — 돌려도 안전한 no-op.
-- 실행: Supabase 대시보드 → SQL Editor → 붙여넣기 → Run.

alter table public.orders
  add column if not exists corp_name  text,
  add column if not exists corp_regno text,
  add column if not exists corp_email text,
  add column if not exists corp_ceo   text,
  add column if not exists corp_addr  text;

create index if not exists orders_corp_regno_idx on public.orders (corp_regno);
