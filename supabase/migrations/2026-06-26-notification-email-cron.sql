-- Planifie l'envoi quotidien de l'email d'alerte de notifications.
-- 05:00 UTC ≈ 7h Paris (décalage ±1h selon l'heure d'été/hiver, accepté —
-- pg_cron ne gère pas les fuseaux horaires).
-- À lancer manuellement dans le SQL editor Supabase après avoir stocké la clé
-- service_role dans Vault (voir task-4-brief.md étape 1).

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'notify-pending-tasks-daily',
  '0 5 * * *',
  $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/notify-pending-tasks',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || vault.decrypted_secret('service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
