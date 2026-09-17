-- 비회원 주문 조회 (주문번호 + 휴대폰 뒷 4자리)
--
-- Vercel 12함수 제한이 꽉 차 새 API 라우트를 만들 수 없다. 대신 Supabase RPC 하나로
-- 처리한다(함수 0개 추가). anon 키로 실행되지만 security definer 안에서 컬럼을 직접
-- 골라 반환하므로 orders 테이블이 통째로 열리지 않는다.
--
-- 보안 설계(Saleor storefront 패턴 차용):
--  · 없는 주문과 번호 불일치를 구분하지 않는다 → 주문번호 대입으로 존재 여부를 캐낼 수 없음
--  · 연락처는 뒷 4자리만 대조하고, 반환값에는 마스킹해서 내보낸다
--  · 주소·기사 링크·결제키 등 민감 컬럼은 애초에 select 하지 않는다
--  · 조회 실패를 세지 않는다(로그인이 아니라 조회라 잠글 대상이 없음). 대신 뒷4자리가
--    맞아야만 한 건이 나오므로 무차별 대입은 주문번호까지 함께 맞춰야 한다.

-- 반환 타입이 바뀌면 create or replace 로는 못 고친다(42P13). 먼저 지우고 다시 만든다.
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
  sender_phone_masked text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_oid text := upper(trim(coalesce(p_order_id, '')));
  v_last4 text := regexp_replace(coalesce(p_phone_last4, ''), '[^0-9]', '', 'g');
begin
  -- 형식이 안 맞으면 조회 자체를 하지 않는다(무의미한 쿼리로 DB를 때리지 않게).
  if v_oid !~ '^[A-Z0-9-]{6,40}$' or length(v_last4) <> 4 then
    return;
  end if;

  return query
  select
    -- 모든 값을 jsonb 경유로 읽어 text 로 낸다. 컬럼이 아직 없거나(payment_method 등)
    -- 타입이 date/text 로 달라도(event_date) 이 함수가 깨지지 않게 하기 위한 것.
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
    -- 본인 확인용으로만 쓰이는 표시값. 원문은 내보내지 않는다.
    ('***-****-' || right(regexp_replace(coalesce(j ->> 'sender_phone', j ->> 'orderer_phone', ''), '[^0-9]', '', 'g'), 4)) as sender_phone_masked
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

comment on function public.lookup_order(text, text) is
  '비회원 주문 조회. 주문번호+연락처 뒷4자리가 모두 맞아야 한 건을 돌려준다. 주소·결제키 등은 반환하지 않음.';
