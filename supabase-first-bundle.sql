-- 꽃안부 1차 안전 묶음 — 1단계: DB 스키마만 적용
--
-- 적용 순서
--   1. 이 파일을 Supabase SQL Editor에서 실행한다.
--   2. 맨 아래 SELECT의 schema_ready=true, duplicate_order_ids=0을 확인한다.
--   3. 웹 코드·Vercel 환경변수를 배포한다.
--   4. 보호된 reconcile API가 200인 것을 확인한 뒤
--      supabase-first-bundle-activate.sql을 실행한다.
--
-- 이 파일은 cron을 스케줄하지 않는다. 스키마 선적용 중 현재 운영 함수가
-- 새 mode=reconcile 요청을 잘못 처리하는 순환 의존을 없애기 위함이다.

-- 중복 order_id가 있으면 아래 DO가 아무 행도 지우지 않고 안전하게 중단한다.
select order_id, count(*) as duplicate_count
from public.orders
where order_id is not null
group by order_id
having count(*) > 1;

do $$
begin
  if exists (
    select 1 from public.orders
    where order_id is not null
    group by order_id
    having count(*) > 1
  ) then
    raise exception using
      message = 'orders.order_id 중복이 있어 1차 안전 묶음을 적용하지 않았습니다.',
      hint = '위 SELECT 결과를 사람이 확인하고 중복 주문을 정리한 뒤 다시 실행하세요.';
  end if;
end $$;

-- 1) orders: 결제 원장·비회원 배송사진 접근·취소 표식
alter table public.orders add column if not exists payment_key text;
alter table public.orders add column if not exists payment_status text;
alter table public.orders add column if not exists payment_method text;
alter table public.orders add column if not exists approved_at timestamptz;
alter table public.orders add column if not exists receipt_url text;
alter table public.orders add column if not exists photo_access_token_hash text;
alter table public.orders add column if not exists photo_access_expires_at timestamptz;
alter table public.orders add column if not exists photo_notice_status text;
alter table public.orders add column if not exists photo_notice_photo text;
alter table public.orders add column if not exists photo_notified_at timestamptz;
alter table public.orders add column if not exists photo_notify_error text;
alter table public.orders add column if not exists photo_notice_lease_until timestamptz;
alter table public.orders add column if not exists canceled_at timestamptz;
alter table public.orders add column if not exists cancel_requested_at timestamptz;
alter table public.orders add column if not exists user_id uuid references auth.users(id) on delete set null;

create unique index if not exists orders_order_id_unique
  on public.orders(order_id);
create unique index if not exists orders_payment_key_unique
  on public.orders(payment_key)
  where payment_key is not null;
create unique index if not exists orders_photo_access_token_hash_unique
  on public.orders(photo_access_token_hash)
  where photo_access_token_hash is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_photo_notice_status_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_photo_notice_status_check
      check (photo_notice_status is null or photo_notice_status in ('pending','sent','failed','skipped'))
      not valid;
  end if;
end $$;

-- 주문 원문에는 연락처·주소·사진경로가 들어 있다. 비회원(anon)은 테이블을
-- 직접 읽지 못하게 하고, 로그인 회원은 기존 "내 주문" SELECT만 유지한다.
alter table public.orders enable row level security;
revoke all on table public.orders from public, anon, authenticated;
grant select on table public.orders to authenticated;
grant all on table public.orders to service_role;
drop policy if exists "read own orders" on public.orders;
create policy "read own orders" on public.orders
  for select to authenticated
  using (auth.uid() = user_id);

-- 비공개 원본 사진 버킷. service_role API만 업로드·프록시하고 public URL은 열지 않는다.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('order-photos', 'order-photos', false, 3145728, array['image/jpeg']::text[])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 2) 토스 창을 열기 전 서버가 주문·금액을 봉인하는 결제 intent
create table if not exists public.payment_intents (
  order_id                    text primary key,
  state                       text not null default 'prepared',
  expected_amount             integer not null,
  order_data                  jsonb not null,
  order_hash                  text not null,
  user_id                     uuid references auth.users(id) on delete set null,
  payment_key                 text,
  toss_status                 text,
  payment_method              text,
  approved_at                 timestamptz,
  receipt_url                 text,
  paid_at                     timestamptz,
  finalized_at                timestamptz,
  finalization_error          text,
  notified_at                 timestamptz,
  alert_sent_at               timestamptz,
  sms_notified_at             timestamptz,
  telegram_notified_at        timestamptz,
  sms_alerted_at              timestamptz,
  telegram_alerted_at         timestamptz,
  sms_notice_lease_until      timestamptz,
  telegram_notice_lease_until timestamptz,
  sms_alert_lease_until       timestamptz,
  telegram_alert_lease_until  timestamptz,
  confirm_attempt_hash         text,
  confirm_lease_until          timestamptz,
  last_checked_at             timestamptz,
  expires_at                  timestamptz not null default (now() + interval '2 hours'),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

-- 이전에 일부만 적용된 동명 테이블도 재실행으로 필수 컬럼을 복구한다.
-- 단, 잘못된 PK/유니크 구조는 임의로 지우지 않고 아래 안전 검사에서 중단한다.
alter table public.payment_intents add column if not exists order_id text;
alter table public.payment_intents add column if not exists state text default 'prepared';
alter table public.payment_intents add column if not exists expected_amount integer;
alter table public.payment_intents add column if not exists order_data jsonb;
alter table public.payment_intents add column if not exists order_hash text;
alter table public.payment_intents add column if not exists user_id uuid;
alter table public.payment_intents add column if not exists payment_key text;
alter table public.payment_intents add column if not exists toss_status text;
alter table public.payment_intents add column if not exists payment_method text;
alter table public.payment_intents add column if not exists approved_at timestamptz;
alter table public.payment_intents add column if not exists receipt_url text;
alter table public.payment_intents add column if not exists paid_at timestamptz;
alter table public.payment_intents add column if not exists finalized_at timestamptz;
alter table public.payment_intents add column if not exists finalization_error text;
alter table public.payment_intents add column if not exists notified_at timestamptz;
alter table public.payment_intents add column if not exists alert_sent_at timestamptz;
alter table public.payment_intents add column if not exists sms_notified_at timestamptz;
alter table public.payment_intents add column if not exists telegram_notified_at timestamptz;
alter table public.payment_intents add column if not exists sms_alerted_at timestamptz;
alter table public.payment_intents add column if not exists telegram_alerted_at timestamptz;
alter table public.payment_intents add column if not exists sms_notice_lease_until timestamptz;
alter table public.payment_intents add column if not exists telegram_notice_lease_until timestamptz;
alter table public.payment_intents add column if not exists sms_alert_lease_until timestamptz;
alter table public.payment_intents add column if not exists telegram_alert_lease_until timestamptz;
alter table public.payment_intents add column if not exists confirm_attempt_hash text;
alter table public.payment_intents add column if not exists confirm_lease_until timestamptz;
alter table public.payment_intents add column if not exists last_checked_at timestamptz;
alter table public.payment_intents add column if not exists expires_at timestamptz default (now() + interval '2 hours');
alter table public.payment_intents add column if not exists created_at timestamptz default now();
alter table public.payment_intents add column if not exists updated_at timestamptz default now();

-- 부분 스키마에 NULL 필수값이 있으면 임의 복구하지 않고 이곳에서 안전하게 중단한다.
alter table public.payment_intents alter column order_id set not null;
alter table public.payment_intents alter column state set default 'prepared';
alter table public.payment_intents alter column state set not null;
alter table public.payment_intents alter column expected_amount set not null;
alter table public.payment_intents alter column order_data set not null;
alter table public.payment_intents alter column order_hash set not null;
alter table public.payment_intents alter column expires_at set default (now() + interval '2 hours');
alter table public.payment_intents alter column expires_at set not null;
alter table public.payment_intents alter column created_at set default now();
alter table public.payment_intents alter column created_at set not null;
alter table public.payment_intents alter column updated_at set default now();
alter table public.payment_intents alter column updated_at set not null;

do $$
declare
  pk_columns text[];
begin
  if exists (
    select 1 from public.payment_intents
    where order_id is not null
    group by order_id having count(*) > 1
  ) then
    raise exception 'payment_intents.order_id 중복이 있어 PK를 복구할 수 없습니다.';
  end if;
  select array_agg(a.attname::text order by k.ordinality)
    into pk_columns
  from pg_constraint c
  cross join lateral unnest(c.conkey) with ordinality as k(attnum, ordinality)
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
  where c.conrelid = 'public.payment_intents'::regclass and c.contype = 'p';
  if pk_columns is null then
    alter table public.payment_intents
      add constraint payment_intents_pkey primary key (order_id);
  elsif pk_columns <> array['order_id']::text[] then
    raise exception 'payment_intents PK가 order_id 단일 컬럼이 아닙니다: %', pk_columns;
  end if;
end $$;

alter table public.payment_intents drop constraint if exists payment_intents_state_check;
alter table public.payment_intents
  add constraint payment_intents_state_check
  check (state in ('prepared','confirming','paid','finalized','canceling','canceled','failed'));
do $$
declare
  conflicting_checks text[];
begin
  select array_agg(conname order by conname)
    into conflicting_checks
  from pg_constraint
  where conrelid = 'public.payment_intents'::regclass
    and contype = 'c'
    and conname <> 'payment_intents_state_check'
    and pg_get_constraintdef(oid) ~* '\mstate\M';
  if conflicting_checks is not null then
    raise exception using
      message = format('추가 state CHECK가 있어 안전 적용을 중단합니다: %s', conflicting_checks),
      hint = '기존 CHECK가 canceling/canceled 상태를 막지 않는지 사람이 확인한 뒤 정리하세요.';
  end if;
end $$;
alter table public.payment_intents drop constraint if exists payment_intents_expected_amount_check;
alter table public.payment_intents
  add constraint payment_intents_expected_amount_check
  check (expected_amount > 0 and expected_amount <= 100000000);
alter table public.payment_intents drop constraint if exists payment_intents_order_hash_check;
alter table public.payment_intents
  add constraint payment_intents_order_hash_check
  check (order_hash ~ '^[a-f0-9]{64}$');

drop index if exists public.payment_intents_reconcile_idx;
create index payment_intents_reconcile_idx
  on public.payment_intents(state, updated_at)
  where state in ('confirming','paid','finalized','canceling','canceled','failed');
create index if not exists payment_intents_expiry_idx
  on public.payment_intents(expires_at)
  where state in ('prepared','failed');
create unique index if not exists payment_intents_payment_key_unique
  on public.payment_intents(payment_key)
  where payment_key is not null;

alter table public.payment_intents enable row level security;
revoke all on table public.payment_intents from public, anon, authenticated;
grant all on table public.payment_intents to service_role;

-- 3) 공개 prepare API의 DB 쓰기 증폭 방지. fingerprint는 서버가 IP를 전용 비밀키로
-- HMAC한 64자 해시이므로 원 IP를 저장하지 않는다.
create table if not exists public.payment_prepare_rate_limits (
  bucket_start  timestamptz not null,
  fingerprint   text not null,
  request_count integer not null default 0,
  primary key (bucket_start, fingerprint)
);
alter table public.payment_prepare_rate_limits add column if not exists bucket_start timestamptz;
alter table public.payment_prepare_rate_limits add column if not exists fingerprint text;
alter table public.payment_prepare_rate_limits add column if not exists request_count integer default 0;
alter table public.payment_prepare_rate_limits alter column bucket_start set not null;
alter table public.payment_prepare_rate_limits alter column fingerprint set not null;
alter table public.payment_prepare_rate_limits alter column request_count set default 0;
alter table public.payment_prepare_rate_limits alter column request_count set not null;

do $$
declare
  pk_columns text[];
begin
  if exists (
    select 1 from public.payment_prepare_rate_limits
    where bucket_start is not null and fingerprint is not null
    group by bucket_start, fingerprint having count(*) > 1
  ) then
    raise exception 'payment_prepare_rate_limits bucket/fingerprint 중복이 있어 PK를 복구할 수 없습니다.';
  end if;
  select array_agg(a.attname::text order by k.ordinality)
    into pk_columns
  from pg_constraint c
  cross join lateral unnest(c.conkey) with ordinality as k(attnum, ordinality)
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
  where c.conrelid = 'public.payment_prepare_rate_limits'::regclass and c.contype = 'p';
  if pk_columns is null then
    alter table public.payment_prepare_rate_limits
      add constraint payment_prepare_rate_limits_pkey primary key (bucket_start, fingerprint);
  elsif pk_columns <> array['bucket_start','fingerprint']::text[] then
    raise exception 'payment_prepare_rate_limits PK가 (bucket_start, fingerprint)가 아닙니다: %', pk_columns;
  end if;
end $$;

alter table public.payment_prepare_rate_limits enable row level security;
revoke all on table public.payment_prepare_rate_limits from public, anon, authenticated;
grant all on table public.payment_prepare_rate_limits to service_role;

create or replace function public.create_payment_intent(
  p_order_id text,
  p_expected_amount bigint,
  p_order_data jsonb,
  p_order_hash text,
  p_user_id uuid,
  p_fingerprint text,
  p_expires_at timestamptz
) returns public.payment_intents
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  bucket timestamptz := date_trunc('hour', now())
    + floor(extract(minute from now()) / 10) * interval '10 minutes';
  fingerprint_count integer;
  global_count integer;
  inserted public.payment_intents;
begin
  if p_order_id !~ '^[A-Za-z0-9_-]{6,64}$'
     or p_expected_amount < 1 or p_expected_amount > 100000000
     or p_order_hash !~ '^[a-f0-9]{64}$'
     or p_fingerprint !~ '^[a-f0-9]{64}$'
     or p_order_data is null or pg_column_size(p_order_data) > 16384
     or p_expires_at <= now() or p_expires_at > now() + interval '2 hours' then
    raise exception using errcode = '22023', message = 'invalid_payment_intent';
  end if;

  -- 서로 다른 fingerprint의 동시 트랜잭션도 전체 500건 한도를 정확히 보게 한다.
  perform pg_advisory_xact_lock(hashtextextended('kkotanbu_payment_prepare_global', 0));

  -- 구형 주문에는 intent가 없어도 orders에 order_id가 이미 있을 수 있다.
  -- 과거 주문번호를 새 결제에 재사용하면 새 배송지가 유실되므로 DB에서도 원자적으로 중단한다.
  if exists (select 1 from public.orders where order_id = p_order_id) then
    raise exception using errcode = '23505', message = 'payment_order_id_already_exists';
  end if;

  insert into public.payment_prepare_rate_limits(bucket_start, fingerprint, request_count)
  values (bucket, p_fingerprint, 1)
  on conflict (bucket_start, fingerprint)
  do update set request_count = public.payment_prepare_rate_limits.request_count + 1
  returning request_count into fingerprint_count;

  select coalesce(sum(request_count), 0)::integer
    into global_count
  from public.payment_prepare_rate_limits
  where bucket_start = bucket;

  if fingerprint_count > 20 or global_count > 500 then
    raise exception using errcode = 'P0001', message = 'payment_prepare_rate_limited';
  end if;

  insert into public.payment_intents(
    order_id, state, expected_amount, order_data, order_hash, user_id, expires_at
  ) values (
    p_order_id, 'prepared', p_expected_amount::integer, p_order_data, p_order_hash,
    p_user_id, p_expires_at
  ) returning * into inserted;
  return inserted;
end $$;

revoke all on function public.create_payment_intent(text,bigint,jsonb,text,uuid,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.create_payment_intent(text,bigint,jsonb,text,uuid,text,timestamptz)
  to service_role;

-- 4) 배송사진 문자 발송과 환불 시작을 주문 단위로 직렬화한다.
-- 세 RPC가 동일한 advisory key + orders row lock 순서를 사용하므로,
-- "사진 문자를 보내는 동안 환불 시작"과 그 역경합을 막는다.

create or replace function public.claim_order_photo_notice(
  p_order_id text,
  p_photo_path text,
  p_token_hash text,
  p_access_expires_at timestamptz,
  p_lease_until timestamptz
)
returns table(result text, lease_until timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_status text;
  v_completed_photo text;
  v_canceled_at timestamptz;
  v_cancel_requested_at timestamptz;
  v_current_lease timestamptz;
  v_intent_state text;
  v_toss_status text;
  v_has_intent boolean := false;
begin
  if p_order_id is null or p_order_id !~ '^[A-Za-z0-9._-]{4,64}$'
     or p_photo_path is null or length(p_photo_path) > 512
     or left(p_photo_path, length(p_order_id) + 1) <> p_order_id || '/'
     or position('..' in p_photo_path) > 0
     or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_access_expires_at is null or p_access_expires_at <= now()
     or p_access_expires_at > now() + interval '31 days'
     or p_lease_until is null or p_lease_until <= now() + interval '5 seconds'
     or p_lease_until > now() + interval '10 minutes' then
    return query select 'invalid_request'::text, null::timestamptz;
    return;
  end if;

  -- begin_order_cancellation과 완전히 같은 키·잠금 순서를 쓴다.
  perform pg_advisory_xact_lock(hashtextextended('floweranbu-order:' || p_order_id, 0));
  select o.status, o.completed_photo, o.canceled_at, o.cancel_requested_at, o.photo_notice_lease_until
    into v_order_status, v_completed_photo, v_canceled_at, v_cancel_requested_at, v_current_lease
    from public.orders o
   where o.order_id = p_order_id
   for update;
  if not found then
    return query select 'order_missing'::text, null::timestamptz;
    return;
  end if;

  if v_order_status <> 'delivered' or v_completed_photo is distinct from p_photo_path then
    return query select 'photo_not_delivered'::text, null::timestamptz;
    return;
  end if;
  if v_canceled_at is not null or v_cancel_requested_at is not null or v_order_status = 'canceled' then
    return query select 'cancel_in_progress'::text, null::timestamptz;
    return;
  end if;

  select i.state, i.toss_status
    into v_intent_state, v_toss_status
    from public.payment_intents i
   where i.order_id = p_order_id
   for update;
  v_has_intent := found;
  if v_has_intent and (v_intent_state in ('canceling', 'canceled') or v_toss_status = 'CANCELED') then
    return query select 'cancel_in_progress'::text, null::timestamptz;
    return;
  end if;

  if v_current_lease is not null and v_current_lease > now() then
    return query select 'photo_notice_busy'::text, v_current_lease;
    return;
  end if;

  update public.orders
     set photo_access_token_hash = p_token_hash,
         photo_access_expires_at = p_access_expires_at,
         photo_notice_status = 'pending',
         photo_notice_photo = p_photo_path,
         photo_notified_at = null,
         photo_notify_error = null,
         photo_notice_lease_until = p_lease_until
   where order_id = p_order_id;

  return query select 'claimed'::text, p_lease_until;
end;
$$;

create or replace function public.finish_order_photo_notice(
  p_order_id text,
  p_photo_path text,
  p_lease_until timestamptz,
  p_notice_status text,
  p_notified_at timestamptz default null,
  p_error text default null
)
returns table(result text, lease_until timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current_lease timestamptz;
  v_completed_photo text;
begin
  if p_order_id is null or p_order_id !~ '^[A-Za-z0-9._-]{4,64}$'
     or p_photo_path is null or p_lease_until is null
     or p_notice_status not in ('sent', 'failed', 'skipped') then
    return query select 'invalid_request'::text, null::timestamptz;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('floweranbu-order:' || p_order_id, 0));
  select o.completed_photo, o.photo_notice_lease_until
    into v_completed_photo, v_current_lease
    from public.orders o
   where o.order_id = p_order_id
   for update;
  if not found then
    return query select 'order_missing'::text, null::timestamptz;
    return;
  end if;
  if v_completed_photo is distinct from p_photo_path
     or v_current_lease is distinct from p_lease_until then
    -- 늦게 끝난 작업이 새 작업의 lease/status를 지우지 못한다.
    return query select 'lease_lost'::text, v_current_lease;
    return;
  end if;

  update public.orders
     set photo_notice_status = p_notice_status,
         photo_notice_photo = p_photo_path,
         photo_notified_at = case when p_notice_status = 'sent' then coalesce(p_notified_at, now()) else null end,
         photo_notify_error = case when p_notice_status = 'sent' then null else left(coalesce(p_error, p_notice_status), 240) end,
         photo_notice_lease_until = null
   where order_id = p_order_id;

  return query select 'finished'::text, null::timestamptz;
end;
$$;

create or replace function public.begin_order_cancellation(
  p_order_id text,
  p_payment_key text,
  p_expected_amount bigint,
  p_order_data jsonb,
  p_order_hash text,
  p_toss_status text,
  p_payment_method text,
  p_approved_at timestamptz,
  p_receipt_url text,
  p_already_canceled boolean default false,
  p_allow_delivered boolean default false,
  p_hold_only boolean default false
)
returns table(result text, lease_until timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_status text;
  v_cancel_requested_at timestamptz;
  v_photo_lease timestamptz;
  v_intent public.payment_intents%rowtype;
  v_has_intent boolean := false;
  v_target_state text;
  v_was_canceling boolean := false;
  v_payment_notice_lease timestamptz;
begin
  if p_order_id is null or p_order_id !~ '^[A-Za-z0-9._-]{6,64}$'
     or p_payment_key is null or length(p_payment_key) < 4 or length(p_payment_key) > 240
     or p_expected_amount is null or p_expected_amount <= 0
     or p_order_data is null or jsonb_typeof(p_order_data) <> 'object'
     or p_order_hash is null or p_order_hash !~ '^[0-9a-f]{64}$' then
    return query select 'invalid_request'::text, null::timestamptz;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('floweranbu-order:' || p_order_id, 0));
  select o.status, o.cancel_requested_at, o.photo_notice_lease_until
    into v_order_status, v_cancel_requested_at, v_photo_lease
    from public.orders o
   where o.order_id = p_order_id
   for update;
  if not found then
    return query select 'order_missing'::text, null::timestamptz;
    return;
  end if;

  -- 이미 시작한 고객 문자와 동시에 '환불 시작'을 만들지 않는다. 호출자는
  -- lease 만료/finish 뒤 재시도하며, 이 결과에서는 Toss cancel을 호출하면 안 된다.
  if v_photo_lease is not null and v_photo_lease > now() then
    return query select 'photo_notice_busy'::text, v_photo_lease;
    return;
  end if;

  -- 텔레그램 서명 링크는 stale API 조회 뒤 배송이 완료되는 경합에서도
  -- 배송완료 주문을 취소하지 못한다. owner 계정 경로만 true를 전달한다.
  if v_order_status = 'delivered' and not coalesce(p_allow_delivered, false) then
    return query select 'delivered_requires_owner'::text, null::timestamptz;
    return;
  end if;

  -- 주문표가 이미 취소라면 토스 취소를 다시 시작하지 않고 원장만 canceled로
  -- 맞춘다. 호출자가 p_already_canceled를 잘못 넘겨도 canceling으로 되돌리지 않는다.
  p_already_canceled := coalesce(p_already_canceled, false) or v_order_status = 'canceled';

  select i.* into v_intent
    from public.payment_intents i
   where i.order_id = p_order_id
   for update;
  v_has_intent := found;

  if v_has_intent then
    -- 결제완료 고객문자/신규주문 Telegram이 공급자 응답을 기다리는 동안
    -- 환불을 시작하면, 환불 뒤에 늦은 "주문 접수" 알림이 도착할 수 있다.
    -- 알림 claim도 state CAS를 쓰므로 여기서 활성 lease를 기다리면 두 작업은
    -- 어느 순서로 시작하든 서로 교차하지 않는다.
    v_payment_notice_lease := greatest(
      v_intent.sms_notice_lease_until,
      v_intent.telegram_notice_lease_until,
      v_intent.sms_alert_lease_until,
      v_intent.telegram_alert_lease_until
    );
    if v_payment_notice_lease is not null and v_payment_notice_lease > now() then
      return query select 'payment_notice_busy'::text, v_payment_notice_lease;
      return;
    end if;

    if v_intent.expected_amount <> p_expected_amount
       or (v_intent.payment_key is not null and v_intent.payment_key <> p_payment_key)
       or v_intent.order_data is null
       or v_intent.order_hash is distinct from p_order_hash
       or v_intent.order_data is distinct from p_order_data
       or v_intent.state not in ('confirming', 'paid', 'finalized', 'canceling', 'canceled') then
      return query select 'intent_payment_mismatch'::text, null::timestamptz;
      return;
    end if;
    v_was_canceling := v_intent.state = 'canceling';
    v_target_state := case
      when p_already_canceled or v_intent.state = 'canceled' then 'canceled'
      when coalesce(p_hold_only, false) then v_intent.state
      else 'canceling'
    end;
    update public.payment_intents
       set state = v_target_state,
           payment_key = p_payment_key,
           toss_status = case when v_target_state = 'canceled' then 'CANCELED' else left(coalesce(p_toss_status, ''), 80) end,
           payment_method = coalesce(payment_method, nullif(left(coalesce(p_payment_method, ''), 120), '')),
           approved_at = coalesce(approved_at, p_approved_at),
           receipt_url = coalesce(receipt_url, nullif(left(coalesce(p_receipt_url, ''), 1000), '')),
           last_checked_at = now(),
           finalization_error = case when coalesce(p_hold_only, false)
             then finalization_error else 'cancel_order_sync_pending' end,
           updated_at = now()
     where order_id = p_order_id;
  else
    if coalesce(p_hold_only, false) then
      return query select 'intent_missing'::text, null::timestamptz;
      return;
    end if;
    v_target_state := case when p_already_canceled then 'canceled' else 'canceling' end;
    insert into public.payment_intents (
      order_id, state, expected_amount, order_data, order_hash, payment_key,
      toss_status, payment_method, approved_at, receipt_url, paid_at,
      finalization_error, last_checked_at, expires_at, created_at, updated_at
    ) values (
      p_order_id, v_target_state, p_expected_amount, p_order_data, p_order_hash, p_payment_key,
      case when v_target_state = 'canceled' then 'CANCELED' else left(coalesce(p_toss_status, ''), 80) end,
      nullif(left(coalesce(p_payment_method, ''), 120), ''), p_approved_at,
      nullif(left(coalesce(p_receipt_url, ''), 1000), ''), p_approved_at,
      'cancel_order_sync_pending', now(), now() + interval '2 hours', now(), now()
    );
  end if;

  update public.orders
     set cancel_requested_at = case
       when status = 'canceled' then cancel_requested_at
       else coalesce(cancel_requested_at, now())
     end
   where order_id = p_order_id;

  return query select
    case
      when coalesce(p_hold_only, false) then 'held'::text
      when v_target_state = 'canceled' or v_order_status = 'canceled' then 'already_canceled'::text
      when v_cancel_requested_at is not null or v_was_canceling then 'already_started'::text
      else 'started'::text
    end,
    null::timestamptz;
end;
$$;

revoke all on function public.claim_order_photo_notice(text,text,text,timestamptz,timestamptz) from public, anon, authenticated;
revoke all on function public.finish_order_photo_notice(text,text,timestamptz,text,timestamptz,text) from public, anon, authenticated;
revoke all on function public.begin_order_cancellation(text,text,bigint,jsonb,text,text,text,timestamptz,text,boolean,boolean,boolean) from public, anon, authenticated;
grant execute on function public.claim_order_photo_notice(text,text,text,timestamptz,timestamptz) to service_role;
grant execute on function public.finish_order_photo_notice(text,text,timestamptz,text,timestamptz,text) to service_role;
grant execute on function public.begin_order_cancellation(text,text,bigint,jsonb,text,text,text,timestamptz,text,boolean,boolean,boolean) to service_role;


-- 5) 관리자 작업 감사. JWT/비밀번호/주소/전화/사진은 넣지 않는다.
create table if not exists public.admin_audit_logs (
  id            bigint generated by default as identity primary key,
  created_at    timestamptz not null default now(),
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_role    text,
  auth_method   text,
  action        text not null,
  resource      text,
  target_id     text,
  outcome       text not null default 'success',
  detail        text,
  request_id    text
);
alter table public.admin_audit_logs add column if not exists created_at timestamptz default now();
alter table public.admin_audit_logs add column if not exists actor_user_id uuid;
alter table public.admin_audit_logs add column if not exists actor_role text;
alter table public.admin_audit_logs add column if not exists auth_method text;
alter table public.admin_audit_logs add column if not exists action text;
alter table public.admin_audit_logs add column if not exists resource text;
alter table public.admin_audit_logs add column if not exists target_id text;
alter table public.admin_audit_logs add column if not exists outcome text default 'success';
alter table public.admin_audit_logs add column if not exists detail text;
alter table public.admin_audit_logs add column if not exists request_id text;
-- 부분 스키마에서 생성된 NULL 필수값은 감사 증거를 임의로 채우지 않고 적용을 중단한다.
alter table public.admin_audit_logs alter column created_at set default now();
alter table public.admin_audit_logs alter column created_at set not null;
alter table public.admin_audit_logs alter column action set not null;
alter table public.admin_audit_logs alter column outcome set default 'success';
alter table public.admin_audit_logs alter column outcome set not null;
create index if not exists admin_audit_logs_created_idx
  on public.admin_audit_logs(created_at desc);
create index if not exists admin_audit_logs_target_idx
  on public.admin_audit_logs(resource, target_id, created_at desc);
alter table public.admin_audit_logs enable row level security;
revoke all on table public.admin_audit_logs from public, anon, authenticated;
grant all on table public.admin_audit_logs to service_role;
grant usage, select on all sequences in schema public to service_role;

-- 6) cron이 실제로 보호 API를 성공 호출했는지 확인하는 heartbeat.
create table if not exists public.first_bundle_runtime (
  name            text primary key,
  activation_at   timestamptz,
  last_started_at timestamptz,
  last_success_at timestamptz,
  last_error      text,
  details         jsonb not null default '{}'::jsonb,
  updated_at      timestamptz not null default now()
);
alter table public.first_bundle_runtime add column if not exists name text;
alter table public.first_bundle_runtime add column if not exists activation_at timestamptz;
alter table public.first_bundle_runtime add column if not exists last_started_at timestamptz;
alter table public.first_bundle_runtime add column if not exists last_success_at timestamptz;
alter table public.first_bundle_runtime add column if not exists last_error text;
alter table public.first_bundle_runtime add column if not exists details jsonb default '{}'::jsonb;
alter table public.first_bundle_runtime add column if not exists updated_at timestamptz default now();
alter table public.first_bundle_runtime alter column name set not null;
alter table public.first_bundle_runtime alter column details set default '{}'::jsonb;
alter table public.first_bundle_runtime alter column details set not null;
alter table public.first_bundle_runtime alter column updated_at set default now();
alter table public.first_bundle_runtime alter column updated_at set not null;
do $$
declare
  pk_columns text[];
begin
  if exists (
    select 1 from public.first_bundle_runtime
    where name is not null
    group by name having count(*) > 1
  ) then
    raise exception 'first_bundle_runtime.name 중복이 있어 PK를 복구할 수 없습니다.';
  end if;
  select array_agg(a.attname::text order by k.ordinality)
    into pk_columns
  from pg_constraint c
  cross join lateral unnest(c.conkey) with ordinality as k(attnum, ordinality)
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
  where c.conrelid = 'public.first_bundle_runtime'::regclass and c.contype = 'p';
  if pk_columns is null then
    alter table public.first_bundle_runtime
      add constraint first_bundle_runtime_pkey primary key (name);
  elsif pk_columns <> array['name']::text[] then
    raise exception 'first_bundle_runtime PK가 name 단일 컬럼이 아닙니다: %', pk_columns;
  end if;
end $$;
alter table public.first_bundle_runtime enable row level security;
revoke all on table public.first_bundle_runtime from public, anon, authenticated;
grant all on table public.first_bundle_runtime to service_role;

-- 7) 단계별 배포 게이트. schema_ready는 1단계, active_ready는 cron+10분 내
-- 성공 heartbeat까지 끝난 2단계를 뜻한다.
create or replace function public.first_bundle_readiness()
returns jsonb
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  required_order_columns text[] := array[
    'payment_key','payment_status','payment_method','approved_at','receipt_url',
    'photo_access_token_hash','photo_access_expires_at','photo_notice_status',
    'photo_notice_photo','photo_notified_at','photo_notify_error','photo_notice_lease_until',
    'canceled_at','cancel_requested_at','user_id','status','completed_photo'
  ];
  required_intent_columns text[] := array[
    'order_id','state','expected_amount','order_data','order_hash','user_id','payment_key',
    'toss_status','payment_method','approved_at','receipt_url','paid_at','finalized_at',
    'finalization_error','notified_at','alert_sent_at','sms_notified_at','telegram_notified_at',
    'sms_alerted_at','telegram_alerted_at','sms_notice_lease_until','telegram_notice_lease_until',
    'sms_alert_lease_until','telegram_alert_lease_until','confirm_attempt_hash','confirm_lease_until',
    'last_checked_at','expires_at',
    'created_at','updated_at'
  ];
  duplicate_count bigint;
  order_columns_ok boolean;
  intent_columns_ok boolean;
  primary_keys_ok boolean;
  state_constraint_ok boolean;
  indexes_ok boolean;
  rls_acl_ok boolean;
  orders_policy_ok boolean;
  rpc_ok boolean;
  coordination_rpcs_ok boolean;
  bucket_private boolean;
  runtime_ok boolean;
  schema_ok boolean;
  cron_ok boolean := false;
  heartbeat_at timestamptz;
  activation_at timestamptz;
  heartbeat_recent boolean := false;
begin
  select count(*) into duplicate_count from (
    select order_id from public.orders where order_id is not null
    group by order_id having count(*) > 1
  ) d;

  select count(*) = cardinality(required_order_columns)
    into order_columns_ok
  from information_schema.columns
  where table_schema = 'public' and table_name = 'orders'
    and column_name = any(required_order_columns);

  select count(*) = cardinality(required_intent_columns)
    into intent_columns_ok
  from information_schema.columns
  where table_schema = 'public' and table_name = 'payment_intents'
    and column_name = any(required_intent_columns);

  select count(*) = 1
    and bool_and(
      conname = 'payment_intents_state_check'
      and pg_get_constraintdef(oid) = $state_check$CHECK ((state = ANY (ARRAY['prepared'::text, 'confirming'::text, 'paid'::text, 'finalized'::text, 'canceling'::text, 'canceled'::text, 'failed'::text])))$state_check$
    )
    into state_constraint_ok
  from pg_constraint
  where conrelid = 'public.payment_intents'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) ~* '\mstate\M';

  select
    coalesce((select array_agg(a.attname::text order by k.ordinality)
      from pg_constraint c
      cross join lateral unnest(c.conkey) with ordinality as k(attnum, ordinality)
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
      where c.conrelid = 'public.payment_intents'::regclass and c.contype = 'p'), array[]::text[])
      = array['order_id']::text[]
    and coalesce((select array_agg(a.attname::text order by k.ordinality)
      from pg_constraint c
      cross join lateral unnest(c.conkey) with ordinality as k(attnum, ordinality)
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
      where c.conrelid = 'public.payment_prepare_rate_limits'::regclass and c.contype = 'p'), array[]::text[])
      = array['bucket_start','fingerprint']::text[]
    and coalesce((select array_agg(a.attname::text order by k.ordinality)
      from pg_constraint c
      cross join lateral unnest(c.conkey) with ordinality as k(attnum, ordinality)
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
      where c.conrelid = 'public.first_bundle_runtime'::regclass and c.contype = 'p'), array[]::text[])
      = array['name']::text[]
    into primary_keys_ok;

  select
    exists (
      select 1 from pg_class i join pg_index x on x.indexrelid = i.oid
      where i.relnamespace = 'public'::regnamespace
        and i.relname = 'orders_order_id_unique' and x.indisunique and x.indisvalid
        and x.indrelid = 'public.orders'::regclass
        and pg_get_indexdef(i.oid) =
          'CREATE UNIQUE INDEX orders_order_id_unique ON public.orders USING btree (order_id)'
    )
    and exists (
      select 1 from pg_class i join pg_index x on x.indexrelid = i.oid
      where i.relnamespace = 'public'::regnamespace
        and i.relname = 'orders_payment_key_unique' and x.indisunique and x.indisvalid
        and x.indrelid = 'public.orders'::regclass
        and pg_get_indexdef(i.oid) =
          'CREATE UNIQUE INDEX orders_payment_key_unique ON public.orders USING btree (payment_key) WHERE (payment_key IS NOT NULL)'
    )
    and exists (
      select 1 from pg_class i join pg_index x on x.indexrelid = i.oid
      where i.relnamespace = 'public'::regnamespace
        and i.relname = 'orders_photo_access_token_hash_unique' and x.indisunique and x.indisvalid
        and x.indrelid = 'public.orders'::regclass
        and pg_get_indexdef(i.oid) =
          'CREATE UNIQUE INDEX orders_photo_access_token_hash_unique ON public.orders USING btree (photo_access_token_hash) WHERE (photo_access_token_hash IS NOT NULL)'
    )
    and exists (
      select 1 from pg_class i join pg_index x on x.indexrelid = i.oid
      where i.relnamespace = 'public'::regnamespace
        and i.relname = 'payment_intents_payment_key_unique' and x.indisunique and x.indisvalid
        and x.indrelid = 'public.payment_intents'::regclass
        and pg_get_indexdef(i.oid) =
          'CREATE UNIQUE INDEX payment_intents_payment_key_unique ON public.payment_intents USING btree (payment_key) WHERE (payment_key IS NOT NULL)'
    ) into indexes_ok;

  rls_acl_ok :=
    (select relrowsecurity from pg_class where oid = 'public.orders'::regclass)
    and (select relrowsecurity from pg_class where oid = 'public.payment_intents'::regclass)
    and (select relrowsecurity from pg_class where oid = 'public.payment_prepare_rate_limits'::regclass)
    and (select relrowsecurity from pg_class where oid = 'public.admin_audit_logs'::regclass)
    and (select relrowsecurity from pg_class where oid = 'public.first_bundle_runtime'::regclass)
    and not has_table_privilege('anon', 'public.orders', 'SELECT')
    and not has_table_privilege('anon', 'public.orders', 'INSERT')
    and not has_table_privilege('anon', 'public.orders', 'UPDATE')
    and not has_table_privilege('anon', 'public.orders', 'DELETE')
    and not has_table_privilege('authenticated', 'public.orders', 'INSERT')
    and not has_table_privilege('authenticated', 'public.orders', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.orders', 'DELETE')
    and has_table_privilege('authenticated', 'public.orders', 'SELECT')
    and has_table_privilege('service_role', 'public.orders', 'SELECT,INSERT,UPDATE,DELETE')
    and not has_table_privilege('anon', 'public.payment_intents', 'SELECT')
    and not has_table_privilege('authenticated', 'public.payment_intents', 'SELECT')
    and not has_table_privilege('anon', 'public.admin_audit_logs', 'INSERT');

  select count(*) = 1
    and bool_and(
      policyname = 'read own orders'
      and permissive = 'PERMISSIVE'
      and roles = array['authenticated']::name[]
      and cmd = 'SELECT'
      and regexp_replace(qual, '[[:space:]]', '', 'g') = '(auth.uid()=user_id)'
      and with_check is null
    )
    into orders_policy_ok
  from pg_policies
  where schemaname = 'public' and tablename = 'orders';

  rpc_ok := to_regprocedure('public.create_payment_intent(text,bigint,jsonb,text,uuid,text,timestamptz)') is not null
    and has_function_privilege('service_role', 'public.create_payment_intent(text,bigint,jsonb,text,uuid,text,timestamptz)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.create_payment_intent(text,bigint,jsonb,text,uuid,text,timestamptz)', 'EXECUTE');

  coordination_rpcs_ok :=
    to_regprocedure('public.claim_order_photo_notice(text,text,text,timestamptz,timestamptz)') is not null
    and to_regprocedure('public.finish_order_photo_notice(text,text,timestamptz,text,timestamptz,text)') is not null
    and to_regprocedure('public.begin_order_cancellation(text,text,bigint,jsonb,text,text,text,timestamptz,text,boolean,boolean,boolean)') is not null
    and has_function_privilege('service_role', 'public.claim_order_photo_notice(text,text,text,timestamptz,timestamptz)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.finish_order_photo_notice(text,text,timestamptz,text,timestamptz,text)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.begin_order_cancellation(text,text,bigint,jsonb,text,text,text,timestamptz,text,boolean,boolean,boolean)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.claim_order_photo_notice(text,text,text,timestamptz,timestamptz)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.claim_order_photo_notice(text,text,text,timestamptz,timestamptz)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.finish_order_photo_notice(text,text,timestamptz,text,timestamptz,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.finish_order_photo_notice(text,text,timestamptz,text,timestamptz,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.begin_order_cancellation(text,text,bigint,jsonb,text,text,text,timestamptz,text,boolean,boolean,boolean)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.begin_order_cancellation(text,text,bigint,jsonb,text,text,text,timestamptz,text,boolean,boolean,boolean)', 'EXECUTE');

  select exists (
    select 1 from storage.buckets where id = 'order-photos' and public = false
      and (allowed_mime_types is null or 'image/jpeg' = any(allowed_mime_types))
  ) into bucket_private;

  runtime_ok := to_regclass('public.first_bundle_runtime') is not null;
  select r.last_success_at, r.activation_at into heartbeat_at, activation_at
  from public.first_bundle_runtime r where r.name = 'payment_reconcile';
  heartbeat_recent := activation_at is not null
    and heartbeat_at is not null
    and heartbeat_at >= activation_at
    and heartbeat_at >= now() - interval '10 minutes';

  if to_regclass('cron.job') is not null then
    execute $q$
      select coalesce(bool_or(
        active
        and schedule = '*/5 * * * *'
        and command like '%https://floweranbu.co.kr/api/check-deadlines?mode=reconcile%'
      ), false)
      from cron.job where jobname = 'kkotanbu-payment-reconcile'
    $q$ into cron_ok;
  end if;

  schema_ok := duplicate_count = 0
    and order_columns_ok and intent_columns_ok and primary_keys_ok
    and state_constraint_ok and indexes_ok
    and rls_acl_ok and orders_policy_ok and rpc_ok and coordination_rpcs_ok
    and bucket_private and runtime_ok;

  return jsonb_build_object(
    'schema_ready', schema_ok,
    'active_ready', schema_ok and cron_ok and heartbeat_recent,
    'duplicate_order_ids', duplicate_count,
    'order_columns_ready', order_columns_ok,
    'intent_columns_ready', intent_columns_ok,
    'primary_keys_ready', primary_keys_ok,
    'state_constraint_ready', state_constraint_ok,
    'indexes_ready', indexes_ok,
    'rls_acl_ready', rls_acl_ok,
    'orders_policy_ready', orders_policy_ok,
    'prepare_rpc_ready', rpc_ok,
    'coordination_rpcs_ready', coordination_rpcs_ok,
    'photo_bucket_private', bucket_private,
    'cron_active', cron_ok,
    'heartbeat_recent', heartbeat_recent,
    'heartbeat_at', heartbeat_at,
    'activation_at', activation_at,
    'checked_at', now()
  );
end;
$$;

revoke all on function public.first_bundle_readiness() from public, anon, authenticated;
grant execute on function public.first_bundle_readiness() to service_role;

select public.first_bundle_readiness();
