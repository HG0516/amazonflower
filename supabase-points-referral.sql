-- =====================================================================
--  적립금 쓰기 · 추천인  (2026-10-25 형구 결정)
--
--  · 쓰기: 3만 원 이상 주문에 한 번 최대 3,000원, 1,000원 단위. 카드·간편결제만
--    (무통장·법인 계산서·맞춤 결제 링크 제외). 같은 전화번호로 다른 계정이 이미
--    적립금을 쓴 적이 있으면 거절(계정 여러 개로 가입 적립을 반복해 쓰는 것 막기).
--  · 추천: 추천 링크로 가입하면 1,000원 더(가입 2,000 + 1,000 = 3,000).
--    친구의 첫 주문(3만 원 이상)이 배송되고 7일이 지나도록 취소가 없으면 추천한 사람 3,000원.
--    한 사람이 받는 추천 보상은 30일에 5명, 1년에 3만 원까지. 전화·주소가 같은 주문은 자기 추천으로 보고 안 줌.
--    매장 안내 문자의 ?ref=shop 은 추천한 사람 없이 가입 1,000원만 더.
--  · 돈이 걸린 적립·차감은 전부 서버(service_role)만 한다. 회원은 자기 추천 코드 조회와
--    가입 직후 추천 코드 등록(claim_referral)만 할 수 있다.
--
--  Supabase → SQL Editor 에 전체 붙여넣고 Run → 맨 아래 points_ready = true 면 끝.
--  여러 번 실행해도 된다.
-- =====================================================================

-- 1) 적립 사유에 '사용취소'(쓴 적립금 돌려주기)·'추천' 추가
alter table public.points_ledger drop constraint if exists points_ledger_reason_check;
alter table public.points_ledger add constraint points_ledger_reason_check
  check (reason in ('가입','리뷰','사용','사용취소','추천','관리자조정'));

-- 같은 주문·같은 사유는 한 번만(차감·반환·추천 보상이 두 번 들어가지 않게)
create unique index if not exists points_ledger_order_reason_once
  on public.points_ledger(order_id, reason) where order_id is not null;

-- 2) 주문에 쓴 적립금(phase2 에 있지만 없는 DB 를 위해 다시)
alter table public.orders add column if not exists discount_points int not null default 0;

-- 3) 추천 코드 · 추천 기록
alter table public.profiles add column if not exists ref_code text;
create unique index if not exists profiles_ref_code_key on public.profiles(ref_code) where ref_code is not null;

create table if not exists public.referrals (
  id               uuid primary key default gen_random_uuid(),
  referrer_user_id uuid references auth.users(id) on delete set null,   -- 매장 링크는 null
  referee_user_id  uuid not null unique references auth.users(id) on delete cascade,
  code             text not null,
  source           text not null default 'member' check (source in ('member','shop')),
  status           text not null default 'pending' check (status in ('pending','rewarded','capped','rejected','done')),
  first_order_id   text,
  decided_at       timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists referrals_pending_idx on public.referrals(status, created_at);
-- 읽기 정책 없음 = 서버 전용. 회원에게는 my_ref_info() 가 숫자만 돌려준다.
alter table public.referrals enable row level security;


-- 4) 내 추천 코드(없으면 만든다) + 추천한 친구 수·받은 적립금
create or replace function public.my_ref_info()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  c text;
  abc text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   -- 헷갈리는 0·O·1·I 뺌
  i int;
  tries int := 0;
begin
  if uid is null then return null; end if;
  insert into public.profiles (user_id) values (uid) on conflict (user_id) do nothing;
  select ref_code into c from public.profiles where user_id = uid;
  while c is null and tries < 20 loop
    tries := tries + 1;
    c := '';
    for i in 1..6 loop
      c := c || substr(abc, 1 + floor(random() * length(abc))::int, 1);
    end loop;
    begin
      update public.profiles set ref_code = c where user_id = uid and ref_code is null;
    exception when unique_violation then
      null;
    end;
    select ref_code into c from public.profiles where user_id = uid;
  end loop;
  return jsonb_build_object(
    'code', c,
    'invited', (select count(*) from public.referrals where referrer_user_id = uid),
    'rewarded', (select count(*) from public.referrals where referrer_user_id = uid and status = 'rewarded'),
    'earned', coalesce((select sum(amount) from public.points_ledger
                        where user_id = uid and reason = '추천' and order_id like 'ref:%'), 0)
  );
end;
$$;


-- 5) 가입 직후 추천 코드 등록 — 가입한 지 24시간 안, 한 계정에 한 번
create or replace function public.claim_referral(p_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  joined timestamptz;
  ref uuid;
  code text := upper(trim(coalesce(p_code, '')));
begin
  if uid is null then return 'login'; end if;
  if code !~ '^[A-Z0-9]{4,12}$' then return 'invalid'; end if;
  select created_at into joined from auth.users where id = uid;
  if joined is null or joined < now() - interval '24 hours' then return 'too_late'; end if;
  if exists (select 1 from public.referrals where referee_user_id = uid) then return 'already'; end if;

  if code = 'SHOP' then
    insert into public.referrals (referrer_user_id, referee_user_id, code, source, status, decided_at)
    values (null, uid, 'SHOP', 'shop', 'done', now())
    on conflict (referee_user_id) do nothing;
  else
    select user_id into ref from public.profiles where ref_code = code;
    if ref is null then return 'invalid'; end if;
    if ref = uid then return 'self'; end if;
    insert into public.referrals (referrer_user_id, referee_user_id, code, source)
    values (ref, uid, code, 'member')
    on conflict (referee_user_id) do nothing;
  end if;

  insert into public.points_ledger (user_id, amount, reason, order_id)
  values (uid, 1000, '추천', 'refjoin:' || uid::text)
  on conflict do nothing;
  return 'ok';
end;
$$;


-- 6) 결제 승인 직전 적립금 차감(서버 전용). 잔액 확인과 차감을 한 번에, 회원별로 줄 세워서.
--    돌려주는 값: ok · already(같은 주문 이미 차감) · insufficient · phone_used · bad
create or replace function public.use_points(p_user uuid, p_order text, p_amount int, p_phone text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  bal int;
  prev record;
  ph text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  if p_user is null or coalesce(p_order, '') = '' or p_amount is null or p_amount <= 0 then return 'bad'; end if;
  perform pg_advisory_xact_lock(hashtext('points:' || p_user::text));

  select user_id, amount into prev from public.points_ledger where order_id = p_order and reason = '사용';
  if found then
    if prev.user_id = p_user and -prev.amount = p_amount
       and not exists (select 1 from public.points_ledger where order_id = p_order and reason = '사용취소') then
      return 'already';
    end if;
    return 'bad';
  end if;

  select coalesce(sum(amount), 0) into bal from public.points_ledger where user_id = p_user;
  if bal < p_amount then return 'insufficient'; end if;

  if length(ph) >= 9 and exists (
    select 1 from public.orders o
    where regexp_replace(coalesce(o.sender_phone, ''), '\D', '', 'g') = ph
      and coalesce(o.discount_points, 0) > 0
      and o.user_id is distinct from p_user
      and coalesce(o.status, '') <> 'canceled'
  ) then
    return 'phone_used';
  end if;

  insert into public.points_ledger (user_id, amount, reason, order_id) values (p_user, -p_amount, '사용', p_order);
  return 'ok';
end;
$$;


-- 7) 쓴 적립금 돌려주기(서버 전용) — 결제 실패 직후 바로 부른다. 두 번 불러도 한 번만 돌려준다.
create or replace function public.restore_points(p_order text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  u record;
begin
  select user_id, amount into u from public.points_ledger where order_id = p_order and reason = '사용';
  if not found then return 'none'; end if;
  insert into public.points_ledger (user_id, amount, reason, order_id)
  values (u.user_id, -u.amount, '사용취소', p_order)
  on conflict do nothing;
  if found then return 'ok'; end if;
  return 'already';
end;
$$;


-- 8) 5분 점검(서버 전용): 취소·만료·결제 안 된 주문의 적립금 돌려주기 + 추천 보상
create or replace function public.points_reconcile()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  fo record;
  restored int := 0;
  rewarded int := 0;
  capped int := 0;
  rejected int := 0;
  month_n int;
  year_sum int;
begin
  -- A) 돌려주기: 주문이 취소·만료됐거나, 2시간이 지나도록 결제된 주문이 없을 때
  for r in
    select l.order_id, l.created_at
    from public.points_ledger l
    where l.reason = '사용'
      and not exists (select 1 from public.points_ledger x where x.order_id = l.order_id and x.reason = '사용취소')
    order by l.created_at
    limit 200
  loop
    if exists (
         select 1 from public.orders o
         where o.order_id = r.order_id and (o.status in ('canceled', 'expired') or o.canceled_at is not null))
       or (r.created_at < now() - interval '2 hours'
           and not exists (select 1 from public.orders o where o.order_id = r.order_id)
           and not exists (select 1 from public.payment_intents pi
                           where pi.order_id = r.order_id and pi.state in ('confirming', 'paid', 'finalized', 'canceling')))
    then
      insert into public.points_ledger (user_id, amount, reason, order_id)
      select user_id, -amount, '사용취소', order_id
      from public.points_ledger where order_id = r.order_id and reason = '사용'
      on conflict do nothing;
      if found then restored := restored + 1; end if;
    end if;
  end loop;

  -- B) 추천 보상: 친구 첫 주문이 배송(또는 받는 날)되고 7일 지남 + 취소 없음
  for r in
    select * from public.referrals
    where status = 'pending' and source = 'member' and referrer_user_id is not null
    order by created_at
    limit 100
  loop
    select o.order_id, o.sender_phone, o.address, o.cancel_requested_at,
           coalesce(o.paid_amount, o.amount, 0) + coalesce(o.discount_points, 0) as total,
           coalesce(o.completed_at, o.event_at, o.created_at) as done_at
      into fo
      from public.orders o
     where o.user_id = r.referee_user_id
       and coalesce(o.status, '') not in ('canceled', 'expired', 'awaiting_deposit')
       and o.canceled_at is null
     order by o.created_at asc
     limit 1;

    if not found then
      if r.created_at < now() - interval '180 days' then
        update public.referrals set status = 'rejected', decided_at = now() where id = r.id;
        rejected := rejected + 1;
      end if;
      continue;
    end if;
    if fo.cancel_requested_at is not null or fo.done_at > now() - interval '7 days' then continue; end if;

    if fo.total < 30000 then
      update public.referrals set status = 'rejected', first_order_id = fo.order_id, decided_at = now() where id = r.id;
      rejected := rejected + 1;
      continue;
    end if;

    -- 자기 추천: 추천한 사람의 주문과 보내는 분 전화나 받는 주소가 같으면 안 준다
    if exists (
      select 1 from public.orders p
      where p.user_id = r.referrer_user_id
        and (
          (length(regexp_replace(coalesce(fo.sender_phone, ''), '\D', '', 'g')) >= 9
           and regexp_replace(coalesce(p.sender_phone, ''), '\D', '', 'g') = regexp_replace(coalesce(fo.sender_phone, ''), '\D', '', 'g'))
          or (coalesce(fo.address, '') <> '' and p.address = fo.address)
        )
    ) then
      update public.referrals set status = 'rejected', first_order_id = fo.order_id, decided_at = now() where id = r.id;
      rejected := rejected + 1;
      continue;
    end if;

    select count(*) filter (where created_at > now() - interval '30 days'),
           coalesce(sum(amount) filter (where created_at > now() - interval '365 days'), 0)
      into month_n, year_sum
      from public.points_ledger
     where user_id = r.referrer_user_id and reason = '추천' and order_id like 'ref:%';
    if month_n >= 5 or year_sum + 3000 > 30000 then
      update public.referrals set status = 'capped', first_order_id = fo.order_id, decided_at = now() where id = r.id;
      capped := capped + 1;
      continue;
    end if;

    insert into public.points_ledger (user_id, amount, reason, order_id)
    values (r.referrer_user_id, 3000, '추천', 'ref:' || r.id::text)
    on conflict do nothing;
    update public.referrals set status = 'rewarded', first_order_id = fo.order_id, decided_at = now() where id = r.id;
    rewarded := rewarded + 1;
  end loop;

  return jsonb_build_object('restored', restored, 'rewarded', rewarded, 'capped', capped, 'rejected', rejected);
end;
$$;


-- 9) 실행 권한: 돈이 오가는 함수는 서버만, 회원은 내 코드 조회·추천 등록만
revoke all on function public.use_points(uuid, text, int, text) from public, anon, authenticated;
revoke all on function public.restore_points(text) from public, anon, authenticated;
revoke all on function public.points_reconcile() from public, anon, authenticated;
grant execute on function public.use_points(uuid, text, int, text) to service_role;
grant execute on function public.restore_points(text) to service_role;
grant execute on function public.points_reconcile() to service_role;
revoke all on function public.claim_referral(text) from public, anon;
revoke all on function public.my_ref_info() from public, anon;
grant execute on function public.claim_referral(text) to authenticated;
grant execute on function public.my_ref_info() to authenticated;


-- 확인
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'discount_points') = 1 as discount_col,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'ref_code') = 1 as ref_code_col,
  to_regclass('public.referrals') is not null as referrals_table,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('my_ref_info','claim_referral','use_points','restore_points','points_reconcile')) = 5 as functions_ok,
  (
    (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'orders' and column_name = 'discount_points') = 1
    and to_regclass('public.referrals') is not null
    and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname in ('my_ref_info','claim_referral','use_points','restore_points','points_reconcile')) = 5
  ) as points_ready;
