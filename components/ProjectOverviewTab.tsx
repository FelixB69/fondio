"use client";

// Onglet « Vue d'ensemble » de l'écran projet.
//
// Lot 1 : accueille les blocs déplacés depuis ProjectDetailScreen (glossaire du
// projet et liste des sessions). Le cockpit — indicateurs, points de vigilance,
// prochaines échéances, activité récente, synthèse — arrive aux lots 2 et 3.
import { AGENTS } from "@/lib/data";
import { C } from "@/lib/design-tokens";
import type { Project, ProjectSessionRow } from "@/lib/projects";
import { Icon, IconName } from "./Icon";

export function ProjectOverviewTab({
  project,
  sessions,
  onOpenSession,
}: {
  project: Project;
  sessions: ProjectSessionRow[];
  onOpenSession: (sessionId: string) => void;
}) {
  const glossary = project.glossary ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Sessions du projet */}
      {sessions.length > 0 && (
        <div>
          <SectionTitle icon="msgSquare" label={`Sessions (${sessions.length})`} />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {sessions.map((s) => {
              const isPanel = Array.isArray(s.panel_agent_ids) && s.panel_agent_ids.length > 1;
              const agent = AGENTS[s.agent_id];
              return (
                <button
                  key={s.id}
                  onClick={() => onOpenSession(s.id)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 12px",
                    background: C.white,
                    border: `1px solid ${C.border}`,
                    borderRadius: 10,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    textAlign: "left",
                    transition: "background 0.12s, border-color 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = C.navyLight;
                    e.currentTarget.style.borderColor = C.navyMid;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = C.white;
                    e.currentTarget.style.borderColor = C.border;
                  }}
                >
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 7,
                      background: agent?.bg ?? C.bg,
                      border: `1.5px solid ${(agent?.color ?? C.border)}25`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <Icon name={(agent?.icon ?? "sparkles") as IconName} size={13} color={agent?.color ?? C.text} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: C.text,
                        lineHeight: 1.3,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {s.title ?? "Nouvelle session"}
                    </div>
                    <div style={{ fontSize: 11, color: C.textSub, marginTop: 2 }}>
                      {isPanel ? `Panel · ${s.panel_agent_ids?.length} agents` : agent?.name} · {formatRelative(s.updated_at)}
                    </div>
                  </div>
                  <Icon name="chevRight" size={12} color={C.textMute} />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Glossaire du projet — termes techniques déjà expliqués */}
      {glossary.length > 0 && (
        <div>
          <SectionTitle icon="book" label={`Glossaire (${glossary.length})`} />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {glossary.map((g, i) => (
              <div
                key={i}
                style={{
                  padding: "9px 12px",
                  background: C.white,
                  border: `1px solid ${C.border}`,
                  borderRadius: 10,
                }}
              >
                <span style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{g.term}</span>
                <div style={{ fontSize: 12.5, color: C.textSub, marginTop: 2, lineHeight: 1.45 }}>
                  {g.definition}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SectionTitle({ icon, label }: { icon: IconName; label: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 10,
        fontSize: 12,
        fontWeight: 800,
        color: C.textSub,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
      }}
    >
      <Icon name={icon} size={12} color={C.textSub} />
      {label}
    </div>
  );
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "À l'instant";
  if (m < 60) return `Il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `Il y a ${h}h`;
  const d = Math.round(h / 24);
  if (d < 7) return `Il y a ${d}j`;
  return new Date(iso).toLocaleDateString("fr-FR");
}
