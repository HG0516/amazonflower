-- =====================================================================
--  가입 적립 1,000P → 2,000P  (2026-10-05 아버지 결정 "응 2,000원")
--
--  · 새로 가입하는 회원: 가입 트리거(handle_new_user)가 2,000P 를 넣는다.
--    함수만 바꾼다 — 프로필 자동 생성·중복 방지·오류를 삼켜 가입을 절대 안 막는 동작은 phase2 그대로.
--  · 이미 가입한 회원: '가입' 적립 합계가 2,000P 보다 적으면 차액을 '가입'으로 한 번 더 넣는다
--    (1,000원 시절 가입자, 사이트 문구가 2,000원으로 바뀐 뒤 이 SQL 전에 가입한 사람 모두).
--    여러 번 실행해도 두 번 안 들어간다 — 합계가 2,000P 가 되면 대상에서 빠진다.
--    ⚠️ reason 칸은 check 제약('가입','리뷰','사용','관리자조정')이 있어 새 사유를 못 쓴다(10/6 '가입 추가'로 실패).
--    트리거의 중복 방지는 '가입' 행이 하나라도 있으면 건너뛰는 것이라, '가입' 두 줄이어도 문제없다.
--  · 화면 문구(index.html·auth.js)는 같은 날 배포됨. 적립금 '사용'(결제 차감)은 아직 없다.
--
--  Supabase → SQL Editor 에 전체 붙여넣고 Run → 맨 아래 확인 결과가 나오면 끝.
-- =====================================================================

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

  -- 가입 축하 2,000P (이 유저에게 '가입' 적립이 아직 없을 때만 — 중복 방지)
  if not exists (
    select 1 from public.points_ledger
    where user_id = new.id and reason = '가입'
  ) then
    insert into public.points_ledger (user_id, amount, reason)
    values (new.id, 2000, '가입');
  end if;

  return new;
exception when others then
  -- 포인트/프로필이 실패해도 회원가입은 성공해야 한다.
  return new;
end;
$$;

-- 이미 가입한 회원 — 가입 적립 합계를 2,000P 로 맞춘다(차액만, 한 번만)
insert into public.points_ledger (user_id, amount, reason)
select user_id, 2000 - sum(amount), '가입'
from public.points_ledger
where reason = '가입'
group by user_id
having sum(amount) < 2000;

-- 가입 적립이 아예 없는 회원(트리거가 조용히 실패한 경우) — 2,000P
insert into public.points_ledger (user_id, amount, reason)
select u.id, 2000, '가입'
from auth.users u
where not exists (
  select 1 from public.points_ledger p
  where p.user_id = u.id and p.reason = '가입'
);

-- 확인: members = 회원 수, min_total·max_total 둘 다 2000 이면 끝
select count(*) as members, min(total) as min_total, max(total) as max_total
from (
  select u.id, coalesce(sum(p.amount), 0) as total
  from auth.users u
  left join public.points_ledger p on p.user_id = u.id and p.reason = '가입'
  group by u.id
) t;
