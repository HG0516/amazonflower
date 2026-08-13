-- 꽃안부 1차 안전 묶음 — 2단계: 결제 대사 cron 활성화
-- 반드시 supabase-first-bundle.sql 적용 + 새 코드·환경변수 배포 후에만 실행한다.
-- 실행 5~10분 후 first_bundle_readiness() active_ready=true를 확인한다.

do $$
declare
  readiness jsonb;
  existing_command text;
  secret_match text[];
  auth_header text;
  old_job_id bigint;
  reconcile_command text;
begin
  select public.first_bundle_readiness() into readiness;
  if coalesce((readiness ->> 'schema_ready')::boolean, false) is not true then
    raise exception '1단계 스키마가 준비되지 않아 cron을 등록하지 않았습니다: %', readiness;
  end if;
  if to_regclass('cron.job') is null then
    raise exception 'pg_cron이 활성화되지 않았습니다.';
  end if;
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    raise exception 'pg_net net.http_post가 활성화되지 않았습니다.';
  end if;

  -- 이미 운영 중인 꽃안부 cron의 Bearer 시크릿을 DB 안에서만 재사용한다.
  -- 시크릿 원문은 NOTICE/SELECT 결과에 출력하지 않는다.
  execute $q$
    select command
    from cron.job
    where jobname in (
      'briefing-morning', 'briefing-noon', 'briefing-evening',
      'kkotanbu-anniversaries-daily'
    )
      and active
    order by jobid
    limit 1
  $q$ into existing_command;

  -- token 뒤의 닫는 따옴표/괄호가 여러 개이거나 여러 줄이어도 허용하되,
  -- token 자체는 공백·따옴표·JSON 닫는 문자 앞에서 끝낸다.
  secret_match := regexp_match(
    coalesce(existing_command, ''),
    $rx$Bearer[[:space:]]+([^'"[:space:]}]+)$rx$
  );
  if secret_match is null or secret_match[1] = '' or secret_match[1] like '<%' then
    raise exception '운영 중인 cron에서 재사용할 CRON_SECRET을 찾지 못했습니다.';
  end if;
  auth_header := 'Bearer ' || secret_match[1];

  execute $q$
    select jobid from cron.job
    where jobname = 'kkotanbu-payment-reconcile'
    limit 1
  $q$ into old_job_id;
  if old_job_id is not null then
    perform cron.unschedule(old_job_id);
  end if;

  -- pg_cron 명령을 하나의 CTE statement로 유지한다. 전혀 시도하지 않은
  -- prepared 자료와 rate bucket만 정리한다. failed/canceling 증거와
  -- 실제 결제·환불 원장은 자동 삭제하지 않는다.
  reconcile_command := format(
    'with clean_rate as ('
    || 'delete from public.payment_prepare_rate_limits where bucket_start < now() - interval ''1 day'' returning 1), '
    || 'clean_unused_intents as ('
    || 'delete from public.payment_intents where state = ''prepared'' '
    || 'and payment_key is null and confirm_attempt_hash is null '
    || 'and last_checked_at is null and finalization_error is null '
    || 'and expires_at < now() - interval ''1 day'' returning 1) '
    || 'select net.http_post(url := %L, headers := jsonb_build_object(''Authorization'', %L), timeout_milliseconds := 25000);',
    'https://floweranbu.co.kr/api/check-deadlines?mode=reconcile',
    auth_header
  );

  perform cron.schedule('kkotanbu-payment-reconcile', '*/5 * * * *', reconcile_command);

  -- 과거 성공 heartbeat가 새 cron 활성 성공으로 오인되지 않게 기준점을
  -- 새로 기록한다. active_ready는 이 시각 이후의 성공만 인정한다.
  insert into public.first_bundle_runtime(
    name, activation_at, last_started_at, last_success_at, last_error, details, updated_at
  ) values (
    'payment_reconcile', now(), null, null, 'awaiting_post_activation_heartbeat',
    jsonb_build_object('activation', 'cron_scheduled'), now()
  )
  on conflict (name) do update set
    activation_at = excluded.activation_at,
    last_started_at = null,
    last_success_at = null,
    last_error = excluded.last_error,
    details = excluded.details,
    updated_at = excluded.updated_at;
end $$;

select public.first_bundle_readiness();
