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

// --- Version HTML de l'email (charte Fondio) ------------------------------
// Un email HTML doit tenir dans le sous-ensemble supporté par Gmail/Outlook :
// tables pour la mise en page, styles 100 % inline, pas de flexbox/grid. Le
// logo est référencé par URL hébergée (les clients bloquent le base64).

// Couleurs de la charte (miroir de lib/design-tokens.ts — dupliquées ici car
// ce module est aussi bundlé par l'Edge Function Deno, hors chaîne Next).
const BRAND = {
  navy: "#264573",
  bg: "#F6F8FC",
  border: "#E8ECF1",
  text: "#1A2438",
  textSub: "#64748B",
  white: "#FFFFFF",
} as const;

// Pastille de couleur par urgence (retard = rouge, aujourd'hui = ambre,
// demain = navy « calme »), avec un fond clair assorti.
const URGENCY_STYLE: Record<NotificationUrgency, { label: string; color: string; bg: string }> = {
  overdue: { label: "En retard", color: "#DC2626", bg: "#FEF2F2" },
  today: { label: "Aujourd'hui", color: "#D97706", bg: "#FFFBEB" },
  tomorrow: { label: "Demain", color: BRAND.navy, bg: "#EEF2FA" },
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function taskRow(t: EmailNotificationTask): string {
  const u = URGENCY_STYLE[t.urgency];
  return `
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid ${BRAND.border};">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td style="vertical-align:top;">
                  <span style="display:inline-block;padding:3px 10px;border-radius:100px;background:${u.bg};color:${u.color};font-size:11px;font-weight:700;letter-spacing:.02em;">${u.label}</span>
                </td>
                <td align="right" style="vertical-align:top;color:${BRAND.textSub};font-size:12px;white-space:nowrap;padding-left:12px;">échéance ${formatDueDate(t.due_date)}</td>
              </tr>
              <tr>
                <td colspan="2" style="padding-top:6px;color:${BRAND.text};font-size:15px;font-weight:600;line-height:1.4;">${escapeHtml(t.content)}</td>
              </tr>
            </table>
          </td>
        </tr>`;
}

export function buildEmailHtml(
  tasks: EmailNotificationTask[],
  agendaUrl: string,
  logoUrl: string,
): string {
  const rows = sortByUrgency(tasks).map(taskRow).join("");
  const count = tasks.length;
  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${BRAND.bg};">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${BRAND.bg};padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:520px;background:${BRAND.white};border:1px solid ${BRAND.border};border-radius:14px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
          <tr>
            <td align="center" style="padding:28px 32px 8px;">
              <img src="${logoUrl}" alt="Fondio" width="132" style="display:block;width:132px;height:auto;border:0;">
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 4px;">
              <h1 style="margin:0;color:${BRAND.text};font-size:19px;font-weight:800;">Vos tâches du jour</h1>
              <p style="margin:6px 0 0;color:${BRAND.textSub};font-size:14px;line-height:1.5;">Vous avez <strong style="color:${BRAND.text};">${count} tâche(s)</strong> qui réclament votre attention.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 4px;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">${rows}
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:24px 32px 32px;">
              <a href="${agendaUrl}" style="display:inline-block;background:${BRAND.navy};color:${BRAND.white};text-decoration:none;font-size:14px;font-weight:700;padding:12px 26px;border-radius:9px;">Ouvrir mon agenda</a>
            </td>
          </tr>
        </table>
        <p style="max-width:520px;margin:16px auto 0;color:#94A3B8;font-size:11px;line-height:1.5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">Fondio — votre copilote de projets IT. Vous recevez cet email car des tâches arrivent à échéance.</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
