-- 기념일 D-7 푸시 자동 발송 — Supabase pg_cron 이 매일 1회 /api/check-anniversaries 를 호출.
-- (check-deadlines 와 동일한 방식)
--
-- 사전 준비:
--   1) Supabase → Database → Extensions 에서 pg_cron, pg_net 활성화
--   2) 아래 <CRON_SECRET> 을 Vercel 환경변수 CRON_SECRET 과 '똑같은 값'으로 바꿔서 RUN
--
-- 스케줄: 매일 UTC 00:00 = 한국시간 09:00 (원하면 조정)

select cron.schedule(
  'kkotanbu-anniversaries-daily',
  '0 0 * * *',
  $$
  select net.http_post(
    url     := 'https://amazonflower.vercel.app/api/check-anniversaries',
    headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>')
  );
  $$
);

-- 해제하려면: select cron.unschedule('kkotanbu-anniversaries-daily');
-- 등록 확인:  select * from cron.job;
