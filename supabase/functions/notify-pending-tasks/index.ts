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
