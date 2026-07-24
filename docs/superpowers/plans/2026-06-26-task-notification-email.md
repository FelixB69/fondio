# Email d'alerte quotidien pour notifications de tâches — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Envoyer à chaque utilisateur, au maximum une fois par jour, un email récapitulant ses tâches en retard / dues aujourd'hui / dues demain, dès qu'il en a au moins une.

**Architecture:** Une fonction SQL `security definer` calcule chaque jour la liste des utilisateurs ayant des notifications en attente (même logique que `pendingNotifications()` côté client) et qui n'ont pas encore reçu d'email aujourd'hui. Un job `pg_cron` appelle quotidiennement une Supabase Edge Function via `pg_net`, qui interroge cette fonction SQL, envoie un email par utilisateur via l'API Resend, puis marque l'utilisateur comme notifié pour la journée.

**Tech Stack:** Supabase (Postgres SQL function, `pg_cron`, `pg_net`, Vault), Supabase Edge Functions (Deno), Resend (API HTTP brute via `fetch`), TypeScript pur testé avec Vitest.

## Global Constraints

- Max un email par jour par utilisateur (tracké par `profiles.last_notification_email_sent_at`).
- Jamais de `CREATE TABLE`/`ALTER` massif sur `schema.sql` — toujours des migrations isolées (cf. piège documenté dans `CLAUDE.md`).
- La fonction SQL `notifications_due_today()` doit être inaccessible à `anon`/`authenticated` — uniquement `service_role` (sinon elle expose les emails et tâches de tous les utilisateurs via RPC).
- Mail en texte simple, pas de template HTML.
- Pas de gestion DST pour l'heure du cron (05:00 UTC fixe, ≈ 7h Paris ± 1h).
- Pas de retry intra-journée en cas d'échec d'envoi : un échec est retenté automatiquement le lendemain.
- Code commenté en français, vouvoiement (convention du projet).
- Commits au format `feat: ...`, première ligne ≤ 70 caractères, en français.

---

### Task 1: Module pur de formatage de l'email (testé avec Vitest)

**Files:**
- Create: `lib/notification-email.ts`
- Test: `lib/notification-email.test.ts`

**Interfaces:**
- Produces: `EmailNotificationTask` type `{ content: string; due_date: string; urgency: "overdue" | "today" | "tomorrow" }`, `sortByUrgency(tasks: EmailNotificationTask[]): EmailNotificationTask[]`, `buildEmailSubject(tasks: EmailNotificationTask[]): string`, `buildEmailBody(tasks: EmailNotificationTask[], agendaUrl: string): string`. Ces exports sont consommés par l'Edge Function du Task 3.

- [ ] **Step 1: Écrire le test qui échoue pour `sortByUrgency`**

Créer `lib/notification-email.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { buildEmailBody, buildEmailSubject, sortByUrgency, EmailNotificationTask } from "./notification-email";

const overdue: EmailNotificationTask = { content: "Relancer le client X", due_date: "2026-06-24", urgency: "overdue" };
const today: EmailNotificationTask = { content: "Préparer le pitch deck", due_date: "2026-06-26", urgency: "today" };
const tomorrow: EmailNotificationTask = { content: "Envoyer la facture", due_date: "2026-06-27", urgency: "tomorrow" };

describe("sortByUrgency", () => {
  it("trie overdue > today > tomorrow", () => {
    expect(sortByUrgency([tomorrow, overdue, today])).toEqual([overdue, today, tomorrow]);
  });

  it("ne mute pas le tableau d'entrée", () => {
    const input = [tomorrow, overdue];
    sortByUrgency(input);
    expect(input).toEqual([tomorrow, overdue]);
  });
});

describe("buildEmailSubject", () => {
  it("inclut le nombre de tâches", () => {
    expect(buildEmailSubject([overdue, today])).toBe("Fondio — 2 tâche(s) à traiter");
  });
});

describe("buildEmailBody", () => {
  it("liste les tâches triées par urgence avec date JJ/MM et lien agenda", () => {
    const body = buildEmailBody([tomorrow, overdue, today], "https://fondio.app/agenda");
    expect(body).toBe(
      "Vous avez 3 tâche(s) qui réclament votre attention :\n\n" +
        "⚠️ En retard : Relancer le client X (échéance 24/06)\n" +
        "📅 Aujourd'hui : Préparer le pitch deck (échéance 26/06)\n" +
        "📅 Demain : Envoyer la facture (échéance 27/06)\n\n" +
        "→ Voir dans l'agenda : https://fondio.app/agenda"
    );
  });
});
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npx vitest run lib/notification-email.test.ts`
Expected: FAIL — `Cannot find module './notification-email'`

- [ ] **Step 3: Implémenter `lib/notification-email.ts`**

```ts
// Formatage de l'email d'alerte quotidien des notifications de tâches.
// Logique pure (pas d'I/O) — réutilisée par l'Edge Function
// supabase/functions/notify-pending-tasks/index.ts.

export type NotificationUrgency = "overdue" | "today" | "tomorrow";

export interface EmailNotificationTask {
  content: string;
  due_date: string;
  urgency: NotificationUrgency;
}

const URGENCY_ORDER: Record<NotificationUrgency, number> = {
  overdue: 0,
  today: 1,
  tomorrow: 2,
};

const URGENCY_LABEL: Record<NotificationUrgency, string> = {
  overdue: "⚠️ En retard",
  today: "📅 Aujourd'hui",
  tomorrow: "📅 Demain",
};

export function sortByUrgency(tasks: EmailNotificationTask[]): EmailNotificationTask[] {
  return [...tasks].sort((a, b) => URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency]);
}

function formatDueDate(ymd: string): string {
  const [, month, day] = ymd.split("-");
  return `${day}/${month}`;
}

export function buildEmailSubject(tasks: EmailNotificationTask[]): string {
  return `Fondio — ${tasks.length} tâche(s) à traiter`;
}

export function buildEmailBody(tasks: EmailNotificationTask[], agendaUrl: string): string {
  const lines = sortByUrgency(tasks).map(
    (t) => `${URGENCY_LABEL[t.urgency]} : ${t.content} (échéance ${formatDueDate(t.due_date)})`
  );
  return [
    `Vous avez ${tasks.length} tâche(s) qui réclament votre attention :`,
    "",
    ...lines,
    "",
    `→ Voir dans l'agenda : ${agendaUrl}`,
  ].join("\n");
}
```

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

Run: `npx vitest run lib/notification-email.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/notification-email.ts lib/notification-email.test.ts
git commit -m "feat: ajoute le formatage de l'email d'alerte de notifications"
```

---

### Task 2: Migration SQL — tracking d'envoi + fonction `notifications_due_today()`

**Files:**
- Create: `supabase/migrations/2026-06-26-notification-email-tracking.sql`

**Interfaces:**
- Consumes: tables existantes `public.tasks (id, user_id, content, status, due_date)`, `public.task_notification_dismissals (user_id, task_id, due_date)`, `public.profiles (user_id)`, `auth.users (id, email)`.
- Produces: colonne `public.profiles.last_notification_email_sent_at date`, fonction `public.notifications_due_today()` retournant `(user_id uuid, email text, tasks jsonb)` où chaque élément de `tasks` a la forme `{ content, due_date, urgency }` — consommée par l'Edge Function du Task 3.

- [ ] **Step 1: Écrire la migration**

Créer `supabase/migrations/2026-06-26-notification-email-tracking.sql` :

```sql
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
```

- [ ] **Step 2: Lancer la migration manuellement dans le SQL editor Supabase**

Coller le contenu du fichier dans le SQL editor du dashboard Supabase et l'exécuter.
Expected: `ALTER TABLE`, `CREATE FUNCTION`, `REVOKE`, `GRANT` tous en succès, aucune erreur.

- [ ] **Step 3: Vérifier manuellement le comportement de la fonction**

Dans le SQL editor, créer une tâche de test en retard pour votre propre utilisateur, puis :

```sql
select * from public.notifications_due_today();
```

Expected: une ligne avec votre `user_id`, votre `email`, et `tasks` contenant la tâche de test avec `"urgency": "overdue"`.

Puis marquer l'envoi comme fait aujourd'hui et revérifier :

```sql
update public.profiles set last_notification_email_sent_at = current_date where user_id = auth.uid();
select * from public.notifications_due_today();
```

Expected: aucune ligne retournée (l'utilisateur a déjà été notifié aujourd'hui). Remettre `last_notification_email_sent_at` à `null` ensuite pour ne pas fausser les tests suivants.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/2026-06-26-notification-email-tracking.sql
git commit -m "feat: ajoute le suivi d'envoi et le calcul SQL des notifications dues"
```

---

### Task 3: Edge Function `notify-pending-tasks`

**Files:**
- Create: `supabase/functions/notify-pending-tasks/index.ts`

**Interfaces:**
- Consumes: `sortByUrgency`, `buildEmailSubject`, `buildEmailBody`, `EmailNotificationTask` de `lib/notification-email.ts` (Task 1) ; RPC `notifications_due_today()` (Task 2) appelée via `service_role`.
- Produces: endpoint HTTP déployé, invoqué par le job `pg_cron` du Task 4.

- [ ] **Step 1: Écrire la fonction**

Créer `supabase/functions/notify-pending-tasks/index.ts` :

```ts
// Edge Function appelée quotidiennement par pg_cron (voir migration
// 2026-06-26-notification-email-cron.sql). Calcule les utilisateurs ayant
// des notifications de tâches en attente et leur envoie un email via Resend,
// au maximum une fois par jour (le filtre "déjà notifié aujourd'hui" est
// fait côté SQL dans notifications_due_today()).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildEmailBody, buildEmailSubject, EmailNotificationTask } from "../../../lib/notification-email.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL")!;
const APP_URL = Deno.env.get("APP_URL")!;

interface NotificationRow {
  user_id: string;
  email: string;
  tasks: EmailNotificationTask[];
}

async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: RESEND_FROM_EMAIL, to, subject, text }),
  });
  if (!res.ok) {
    console.error(`Resend error pour ${to} : ${res.status} ${await res.text()}`);
    return false;
  }
  return true;
}

Deno.serve(async () => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data, error } = await supabase.rpc("notifications_due_today");

  if (error) {
    console.error("notifications_due_today a échoué :", error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const rows = (data ?? []) as NotificationRow[];
  let sent = 0;

  for (const row of rows) {
    const subject = buildEmailSubject(row.tasks);
    const body = buildEmailBody(row.tasks, `${APP_URL}/agenda`);
    const ok = await sendEmail(row.email, subject, body);
    if (!ok) continue;

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ last_notification_email_sent_at: new Date().toISOString().slice(0, 10) })
      .eq("user_id", row.user_id);

    if (updateError) {
      console.error(`Échec du marquage d'envoi pour ${row.user_id} :`, updateError.message);
      continue;
    }
    sent++;
  }

  return new Response(JSON.stringify({ processed: rows.length, sent }), {
    headers: { "Content-Type": "application/json" },
  });
});
```

**Note sur l'import cross-dossier :** l'import relatif `../../../lib/notification-email.ts` sort du dossier `supabase/functions/`. Les versions récentes de la CLI Supabase (`supabase functions deploy`) résolvent le graphe d'imports complet et embarquent les fichiers externes référencés. Si le déploiement échoue avec une erreur de résolution de module, copier le contenu de `lib/notification-email.ts` dans `supabase/functions/notify-pending-tasks/email-content.ts` et ajuster l'import en conséquence — dans ce cas, dupliquer aussi les tests dans ce fichier n'est pas nécessaire : Task 1 reste la source de vérité testée.

- [ ] **Step 2: Configurer les secrets de la fonction**

```bash
npx supabase secrets set RESEND_API_KEY=<votre clé Resend> --project-ref <project-ref>
npx supabase secrets set RESEND_FROM_EMAIL="Fondio <notifications@votre-domaine.com>" --project-ref <project-ref>
npx supabase secrets set APP_URL=https://<votre domaine de prod> --project-ref <project-ref>
```

`SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` sont injectées automatiquement par Supabase dans toutes les Edge Functions, pas besoin de les configurer.

- [ ] **Step 3: Déployer et vérifier manuellement**

```bash
npx supabase functions deploy notify-pending-tasks --project-ref <project-ref>
```

Puis invoquer manuellement pour vérifier le comportement de bout en bout (avec une vraie tâche en retard sur votre compte de test, comme au Task 2 Step 3) :

```bash
curl -X POST "https://<project-ref>.supabase.co/functions/v1/notify-pending-tasks" \
  -H "Authorization: Bearer <service_role key>"
```

Expected: réponse `{"processed":1,"sent":1}`, email reçu dans la boîte de test, et `profiles.last_notification_email_sent_at` mis à jour à la date du jour (vérifiable via le SQL editor).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/notify-pending-tasks/index.ts
git commit -m "feat: ajoute l'Edge Function d'envoi d'email de notifications"
```

---

### Task 4: Planification quotidienne via `pg_cron`

**Files:**
- Create: `supabase/migrations/2026-06-26-notification-email-cron.sql`

**Interfaces:**
- Consumes: URL déployée de l'Edge Function `notify-pending-tasks` (Task 3), clé `service_role` du projet.

- [ ] **Step 1: Stocker la clé `service_role` dans Vault**

Dans le SQL editor Supabase, exécuter (remplacer `<service-role-key>` par la vraie clé, visible dans Project Settings → API) :

```sql
select vault.create_secret('<service-role-key>', 'service_role_key');
```

Expected : une ligne retournée avec l'`id` du secret créé.

- [ ] **Step 2: Écrire la migration de planification**

Créer `supabase/migrations/2026-06-26-notification-email-cron.sql` (remplacer `<project-ref>` par la référence réelle du projet) :

```sql
-- Planifie l'envoi quotidien de l'email d'alerte de notifications.
-- 05:00 UTC ≈ 7h Paris (décalage ±1h selon l'heure d'été/hiver, accepté —
-- pg_cron ne gère pas les fuseaux horaires).

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
```

- [ ] **Step 3: Lancer la migration manuellement dans le SQL editor Supabase**

Coller et exécuter le contenu du fichier.
Expected: `CREATE EXTENSION` (×2, ou "already exists" si déjà actives), puis une ligne retournée par `cron.schedule` avec l'`jobid` créé.

- [ ] **Step 4: Vérifier que le job est bien planifié**

```sql
select jobid, schedule, command from cron.job where jobname = 'notify-pending-tasks-daily';
```

Expected: une ligne avec `schedule = '0 5 * * *'`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/2026-06-26-notification-email-cron.sql
git commit -m "feat: planifie l'envoi quotidien de l'email de notifications via pg_cron"
```
