# Email d'alerte quotidien pour notifications de tâches

Date : 2026-06-26

## Objectif

Dès qu'un utilisateur a au moins une notification de tâche en attente (en retard,
due aujourd'hui, ou due demain — même logique que la cloche in-app), il reçoit
un email récapitulatif. Maximum un email par jour par utilisateur, même si le
nombre de notifications change pendant la journée.

## Contexte existant

- Les notifications sont calculées 100% côté client aujourd'hui :
  `pendingNotifications()` dans [lib/tasks.ts:270-284](../../../lib/tasks.ts#L270-L284),
  appelé depuis `AppDataProvider` ([components/AppDataProvider.tsx:98-101](../../../components/AppDataProvider.tsx#L98-L101)).
- Une notification existe si `task.status !== 'done'`, `task.due_date` est
  défini, et l'écart en jours avec aujourd'hui donne `overdue` (< 0), `today`
  (= 0) ou `tomorrow` (= 1).
- Les dismissals (clic sur la cloche) sont stockés dans
  `public.task_notification_dismissals` (clé `(user_id, task_id, due_date)`),
  voir [supabase/migrations/2026-06-26-task-notification-dismissals.sql](../../../supabase/migrations/2026-06-26-task-notification-dismissals.sql).
  Si la `due_date` change après un dismiss, la notification réapparaît
  automatiquement.
- Aucune infrastructure serveur planifiée n'existe dans le projet (pas
  d'Edge Functions, pas de cron) et aucune capacité d'envoi d'email n'est
  intégrée (hors emails natifs Supabase Auth).

## Architecture retenue

```
pg_cron (05:00 UTC, quotidien)
  → net.http_post() vers l'Edge Function "notify-pending-tasks"
      (Authorization: Bearer <service_role key, stockée dans Vault>)
    → Edge Function (Deno) :
        1. RPC notifications_due_today()
        2. pour chaque ligne : envoi email via API Resend (fetch)
        3. si envoi OK : UPDATE profiles.last_notification_email_sent_at = current_date
        4. erreur sur un utilisateur → log, continue les autres (pas de retry le même jour)
```

### 1. Stockage (migration isolée)

Nouveau fichier `supabase/migrations/<date>-notification-email-tracking.sql`,
isolé du `schema.sql` principal (cf. piège documenté dans CLAUDE.md : ne jamais
toucher `schema.sql` directement, toujours des `ALTER TABLE` isolés) :

```sql
alter table public.profiles
  add column if not exists last_notification_email_sent_at date;
```

### 2. Fonction SQL `notifications_due_today()`

`security definer`, car c'est le seul moyen propre d'exposer `auth.users.email`
à l'Edge Function sans contourner RLS depuis le client. Réplique exactement la
logique de `pendingNotifications()` :

- Pour chaque utilisateur ayant au moins une tâche `status != 'done'` avec
  `due_date` dans `[overdue, today, tomorrow]` et non dismissed,
- **et** dont `profiles.last_notification_email_sent_at` n'est pas déjà
  `current_date` (évite le double envoi),
- retourne `(user_id uuid, email text, tasks jsonb)` où `tasks` contient
  `{ content, urgency, due_date }` triés overdue > today > tomorrow (même
  ordre que `compareTasks` côté client).

### 3. Edge Function `notify-pending-tasks`

- Runtime Deno, appelée uniquement par le job pg_cron (JWT service_role
  requis, pas d'accès public).
- Variables d'env : `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `APP_URL`.
- Boucle sur les lignes retournées par la RPC, envoie un email par
  utilisateur via l'API HTTP de Resend (pas besoin du SDK npm, juste `fetch`).
- Après un envoi réussi : `UPDATE profiles SET
  last_notification_email_sent_at = current_date WHERE user_id = $1`.
- Un échec d'envoi pour un utilisateur est loggé et n'interrompt pas le
  traitement des autres utilisateurs ; il sera retenté automatiquement le
  lendemain (pas de retry intra-journée).

### 4. Déclenchement pg_cron

Migration qui active les extensions `pg_cron` et `pg_net`, et programme :

```sql
select cron.schedule(
  'notify-pending-tasks-daily',
  '0 5 * * *', -- 05:00 UTC ≈ 7h Paris (décalage ±1h selon DST, accepté)
  $$
  select net.http_post(
    url := '<edge-function-url>/notify-pending-tasks',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || vault.decrypted_secret('service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

La clé `service_role` est stockée via Supabase Vault, jamais en clair dans la
migration.

**Limitation acceptée** : `pg_cron` ne gère pas les fuseaux horaires ; l'heure
réelle d'envoi varie de ±1h entre l'heure d'été et d'hiver à Paris. Pas de
sur-ingénierie pour corriger ce décalage.

### 5. Contenu de l'email

Texte simple, pas de template HTML complexe. Sujet :
`Fondio — N tâche(s) à traiter`. Corps, trié par urgence :

```
Vous avez 3 tâche(s) qui réclament votre attention :

⚠️ En retard : Relancer le client X (échéance 24/06)
📅 Aujourd'hui : Préparer le pitch deck
📅 Demain : Envoyer la facture

→ Voir dans l'agenda : https://<APP_URL>/agenda
```

Lien générique vers `/agenda` (pas de lien par tâche individuelle).

## Configuration requise avant déploiement

- Compte Resend + domaine vérifié (ou `onboarding@resend.dev` en attendant).
- Secrets Edge Function : `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `APP_URL`.
- Secret Vault Supabase pour la clé `service_role` utilisée par pg_cron.

## Hors scope

- Pas de préférences utilisateur pour désactiver l'email (pourra être ajouté
  plus tard si demandé).
- Pas de template HTML riche.
- Pas de gestion DST précise pour l'heure d'envoi.
- Pas de retry intra-journée en cas d'échec d'envoi.
