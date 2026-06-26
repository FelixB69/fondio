-- Email d'alerte quotidien des notifications de tâches (cron → Edge Function).
-- Isolé du schema.sql principal — à lancer manuellement dans le SQL editor
-- Supabase. La fonction est security definer car c'est le seul moyen
-- d'exposer auth.users.email à l'Edge Function sans contourner les RLS
-- depuis le client ; son exécution est donc restreinte à service_role.

alter table public.profiles
  add column if not exists last_notification_email_sent_at date;

create or replace function public.notifications_due_today()
returns table (user_id uuid, email text, tasks jsonb)
language sql
security definer
set search_path = public
as $$
  select
    t.user_id,
    u.email,
    jsonb_agg(
      jsonb_build_object(
        'content', t.content,
        'due_date', t.due_date,
        'urgency', case
          when t.due_date < current_date then 'overdue'
          when t.due_date = current_date then 'today'
          else 'tomorrow'
        end
      )
    ) as tasks
  from public.tasks t
  join auth.users u on u.id = t.user_id
  join public.profiles p on p.user_id = t.user_id
  where t.status <> 'done'
    and t.due_date is not null
    and t.due_date <= current_date + 1
    and (p.last_notification_email_sent_at is null or p.last_notification_email_sent_at < current_date)
    and not exists (
      select 1 from public.task_notification_dismissals d
      where d.task_id = t.id and d.due_date = t.due_date and d.user_id = t.user_id
    )
  group by t.user_id, u.email;
$$;

revoke all on function public.notifications_due_today() from public, anon, authenticated;
grant execute on function public.notifications_due_today() to service_role;
