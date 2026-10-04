-- 꽃안부 입금 대기 주문(가상계좌·무통장입금) — DB 칸 추가
--
-- 적용 순서(2026-10-04)
--   0. supabase-first-bundle.sql 이 먼저 적용돼 있어야 한다(ACTIVATION.md 0-1단계).
--      아래 결제 칸(payment_*)은 그 파일과 같은 이름이라 먼저 돌려도 충돌은 없지만,
--      관리자 목록·상태변경이 그 파일의 다른 칸에 기대므로 순서를 지킨다.
--   1. 이 파일을 Supabase SQL Editor 에서 실행한다. 맨 아래 SELECT 가 deposit_ready=true.
--   2. Vercel 환경변수 BANK_TRANSFER_ENABLED=1 / VIRTUAL_ACCOUNT_ENABLED=1 → Redeploy.
--      가상계좌는 토스 개발자센터 웹훅 등록이 먼저다(아래 주석).
--
-- 모든 문장이 "없으면 만든다"라 여러 번 돌려도 된다. 기존 주문·데이터는 바꾸지 않는다.

alter table public.orders add column if not exists payment_key text;
alter table public.orders add column if not exists payment_status text;
alter table public.orders add column if not exists payment_method text;
alter table public.orders add column if not exists approved_at timestamptz;
alter table public.orders add column if not exists receipt_url text;

-- 가상계좌: 손님이 입금할 계좌·기한, 입금 웹훅 비밀값(해시만), 입금 확인 시각
alter table public.orders add column if not exists va_bank text;
alter table public.orders add column if not exists va_account text;
alter table public.orders add column if not exists va_due timestamptz;
alter table public.orders add column if not exists va_secret_hash text;
alter table public.orders add column if not exists deposited_at timestamptz;

-- 30분 크론이 입금 대기 주문만 빠르게 찾는다
create index if not exists orders_awaiting_deposit_idx
  on public.orders (created_at)
  where status = 'awaiting_deposit';

-- 주문 조회(비회원) — 입금 대기 주문에 입금할 계좌·기한을 함께 돌려준다.
-- 반환 칸이 바뀌어 create or replace 로는 못 고친다(42P13) → 지우고 다시.
drop function if exists public.lookup_order(text, text);

create or replace function public.lookup_order(p_order_id text, p_phone_last4 text)
returns table (
  order_id            text,
  status              text,
  product_label       text,
  amount              int,
  event_date          text,
  event_time          text,
  delivery_time_slot  text,
  recipient_name      text,
  venue               text,
  ribbon              text,
  payment_method      text,
  receipt_url         text,
  created_at          text,
  ordered_at          text,
  completed_at        text,
  canceled_at         text,
  has_photo           boolean,
  sender_phone_masked text,
  va_bank             text,
  va_account          text,
  va_due              text,
  deposited_at        text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_oid text := upper(trim(coalesce(p_order_id, '')));
  v_last4 text := regexp_replace(coalesce(p_phone_last4, ''), '[^0-9]', '', 'g');
begin
  if v_oid !~ '^[A-Z0-9-]{6,40}$' or length(v_last4) <> 4 then
    return;
  end if;

  return query
  select
    j ->> 'order_id'           as order_id,
    j ->> 'status'             as status,
    j ->> 'product_label'      as product_label,
    coalesce(o.paid_amount, o.amount) as amount,
    nullif(j ->> 'event_date', '')         as event_date,
    nullif(j ->> 'event_time', '')         as event_time,
    nullif(j ->> 'delivery_time_slot', '') as delivery_time_slot,
    nullif(j ->> 'recipient_name', '')     as recipient_name,
    nullif(j ->> 'venue', '')              as venue,
    nullif(j ->> 'ribbon', '')             as ribbon,
    nullif(j ->> 'payment_method', '')     as payment_method,
    nullif(j ->> 'receipt_url', '')        as receipt_url,
    nullif(j ->> 'created_at', '')         as created_at,
    nullif(j ->> 'ordered_at', '')         as ordered_at,
    nullif(j ->> 'completed_at', '')       as completed_at,
    nullif(j ->> 'canceled_at', '')        as canceled_at,
    ((j ->> 'completed_photo') is not null) as has_photo,
    ('***-****-' || right(regexp_replace(coalesce(j ->> 'sender_phone', j ->> 'orderer_phone', ''), '[^0-9]', '', 'g'), 4)) as sender_phone_masked,
    -- 입금 대기일 때만 계좌를 돌려준다(입금이 끝난 뒤엔 보여줄 이유가 없다).
    case when j ->> 'status' = 'awaiting_deposit' then nullif(j ->> 'va_bank', '') end    as va_bank,
    case when j ->> 'status' = 'awaiting_deposit' then nullif(j ->> 'va_account', '') end as va_account,
    case when j ->> 'status' = 'awaiting_deposit' then nullif(j ->> 'va_due', '') end     as va_due,
    nullif(j ->> 'deposited_at', '')       as deposited_at
  from public.orders o
  cross join lateral (select to_jsonb(o) as j) t
  where upper(o.order_id) = v_oid
    and (
      right(regexp_replace(coalesce(j ->> 'sender_phone', ''), '[^0-9]', '', 'g'), 4) = v_last4
      or right(regexp_replace(coalesce(j ->> 'orderer_phone', ''), '[^0-9]', '', 'g'), 4) = v_last4
      or right(regexp_replace(coalesce(j ->> 'recipient_phone', ''), '[^0-9]', '', 'g'), 4) = v_last4
    )
  limit 1;
end;
$$;

revoke all on function public.lookup_order(text, text) from public;
grant execute on function public.lookup_order(text, text) to anon, authenticated;

-- 가상계좌 입금 웹훅(코드가 아니라 토스 화면에서 1회):
--   https://developers.tosspayments.com/my/webhooks → 라이브 상점(MID) 선택 → 웹훅 추가
--   URL: https://floweranbu.co.kr/api/confirm-payment?hook=deposit
--   이벤트: DEPOSIT_CALLBACK (PAYMENT_STATUS_CHANGED 는 함께 켜지 않는다 — 중복 수신)

select jsonb_build_object(
  'deposit_ready', (
    select count(*) = 10 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders'
      and column_name in ('payment_key','payment_status','payment_method','approved_at','receipt_url',
                          'va_bank','va_account','va_due','va_secret_hash','deposited_at')
  ),
  'lookup_order_ready', to_regprocedure('public.lookup_order(text,text)') is not null,
  'checked_at', now()
) as result;
