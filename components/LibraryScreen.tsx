"use client";

import { useEffect, useMemo, useState } from "react";
import { AGENTS, AgentId, ChatMessage, ProjectType, PROJECT_TYPES } from "@/lib/data";
import { C } from "@/lib/design-tokens";
import { createClient } from "@/lib/supabase/client";
import { useIsMobile } from "@/lib/use-responsive";
import { Icon, IconName } from "./Icon";

interface DeliverableEntry {
  id: string;
  text: string;
  sessionId: string;
  sessionTitle: string;
  agentId: AgentId;
  projectType: ProjectType;
  ts: string;
}

interface SessionRow {
  id: string;
  title: string | null;
  agent_id: AgentId;
  project_type: ProjectType;
  messages: ChatMessage[];
  updated_at: string;
}

type FilterMode = "all" | ProjectType;

// Agent de secours quand un livrable référence un agent_id qui n'existe plus
// (agent renommé/supprimé dans data.ts). Évite le crash et garde le livrable visible.
const FALLBACK_AGENT = {
  name: "Agent inconnu",
  icon: "sparkles" as IconName,
  color: C.textMute,
  bg: C.bg,
};

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

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportSessionMarkdown(
  sessionTitle: string,
  agentName: string,
  items: DeliverableEntry[],
): string {
  const date = new Date().toLocaleDateString("fr-FR");
  return [
    `# ${sessionTitle}`,
    ``,
    `_Conseiller : ${agentName} · Export du ${date}_`,
    ``,
    `## Livrables`,
    ``,
    ...items.map((it) => `- ${it.text}`),
    ``,
  ].join("\n");
}

export function LibraryScreen({
  onOpenSession,
}: {
  onOpenSession: (id: string) => void;
}) {
  const isMobile = useIsMobile();
  const supabase = createClient();
  const [entries, setEntries] = useState<DeliverableEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [agentFilter, setAgentFilter] = useState<AgentId | "all">("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("sessions")
        .select("id, title, agent_id, project_type, messages, updated_at")
        .order("updated_at", { ascending: false });
      if (cancelled) return;

      const flat: DeliverableEntry[] = [];
      for (const row of (data ?? []) as SessionRow[]) {
        const msgs = Array.isArray(row.messages) ? row.messages : [];
        msgs.forEach((m, mi) => {
          if (m.role !== "assistant" || !m.deliverables?.length) return;
          m.deliverables.forEach((d, di) => {
            flat.push({
              id: `${row.id}-${mi}-${di}`,
              text: d,
              sessionId: row.id,
              sessionTitle: row.title ?? "Session sans titre",
              agentId: row.agent_id,
              projectType: row.project_type,
              ts: m.ts,
            });
          });
        });
      }
      setEntries(flat);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const filtered = useMemo(() => {
    return entries.filter(
      (e) =>
        (filter === "all" || e.projectType === filter) &&
        (agentFilter === "all" || e.agentId === agentFilter),
    );
  }, [entries, filter, agentFilter]);

  // Groupe par session pour l'affichage en cards.
  const grouped = useMemo(() => {
    const map = new Map<string, DeliverableEntry[]>();
    for (const e of filtered) {
      const arr = map.get(e.sessionId) ?? [];
      arr.push(e);
      map.set(e.sessionId, arr);
    }
    return Array.from(map.entries()).map(([sid, items]) => ({
      sessionId: sid,
      sessionTitle: items[0].sessionTitle,
      agentId: items[0].agentId,
      projectType: items[0].projectType,
      ts: items[0].ts,
      items,
    }));
  }, [filtered]);

  // Agents qui ont au moins un livrable (pour les chips de filtre).
  // On ignore les ids orphelins (agents renommés/supprimés) absents de AGENTS,
  // sinon le bouton-filtre planterait en lisant agent.icon sur un undefined.
  const usedAgents = useMemo(() => {
    const s = new Set<AgentId>();
    entries.forEach((e) => {
      if (AGENTS[e.agentId]) s.add(e.agentId);
    });
    return Array.from(s);
  }, [entries]);

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        background: C.bg,
        overflow: "hidden",
        animation: "fndFadeIn 0.18s ease",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: isMobile ? "14px 16px 12px" : "20px 28px 14px",
          background: C.white,
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <Icon name="book" size={20} color={C.navy} />
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: C.text, letterSpacing: "-0.02em" }}>
            Bibliothèque
          </h1>
        </div>
        <p style={{ margin: "0 0 14px", fontSize: 13, color: C.textSub }}>
          Tous les livrables produits par tes agents, regroupés par session.
        </p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {([
            { id: "all", label: "Tous", icon: null },
            { id: "pro", label: "Pro", icon: "briefcase" },
            { id: "perso", label: "Perso", icon: "sprout" },
          ] as const).map(({ id, label, icon }) => {
            const active = filter === id;
            return (
              <button
                key={id}
                onClick={() => setFilter(id as FilterMode)}
                style={{
                  background: active ? C.navy : C.white,
                  color: active ? "white" : C.textSub,
                  border: `1.5px solid ${active ? C.navy : C.border}`,
                  borderRadius: 100,
                  padding: "5px 13px",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {icon && <Icon name={icon as IconName} size={12} style={{ marginRight: 4 }} />}
                {label}
              </button>
            );
          })}
          <div style={{ width: 1, background: C.border, margin: "0 4px" }} />
          <button
            onClick={() => setAgentFilter("all")}
            style={{
              background: agentFilter === "all" ? C.navyLight : C.white,
              color: agentFilter === "all" ? C.navy : C.textSub,
              border: `1.5px solid ${agentFilter === "all" ? C.navyMid : C.border}`,
              borderRadius: 100,
              padding: "5px 13px",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Tous agents
          </button>
          {usedAgents.map((aid) => {
            const agent = AGENTS[aid];
            const active = agentFilter === aid;
            return (
              <button
                key={aid}
                onClick={() => setAgentFilter(aid)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  background: active ? agent.bg : C.white,
                  color: active ? agent.color : C.textSub,
                  border: `1.5px solid ${active ? agent.color : C.border}`,
                  borderRadius: 100,
                  padding: "4px 11px 4px 8px",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                <Icon name={agent.icon as IconName} size={13} color={agent.color} />
                {agent.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: isMobile ? "12px 12px 24px" : "18px 28px 32px" }}>
        {loading && <div style={{ color: C.textMute, fontSize: 13 }}>Chargement…</div>}

        {!loading && grouped.length === 0 && (
          <div
            style={{
              marginTop: 60,
              textAlign: "center",
              color: C.textMute,
              fontSize: 14,
              maxWidth: 380,
              marginLeft: "auto",
              marginRight: "auto",
              lineHeight: 1.6,
            }}
          >
            Aucun livrable pour le moment.
            <br />
            Discute avec un agent, ils en produisent automatiquement quand ils ont quelque chose de
            concret à proposer.
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {grouped.map((g) => {
            const agent = AGENTS[g.agentId] ?? FALLBACK_AGENT;
            const meta = PROJECT_TYPES[g.projectType];
            return (
              <div
                key={g.sessionId}
                style={{
                  background: C.white,
                  border: `1px solid ${C.border}`,
                  borderRadius: 12,
                  padding: "16px 18px",
                  boxShadow: C.shadow,
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      background: agent.bg,
                      border: `1.5px solid ${agent.color}25`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 16,
                      flexShrink: 0,
                    }}
                  >
                    <Icon name={agent.icon as IconName} size={16} color={agent.color} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 14.5,
                        fontWeight: 800,
                        color: C.text,
                        letterSpacing: "-0.02em",
                        lineHeight: 1.3,
                      }}
                    >
                      {g.sessionTitle}
                    </div>
                    <div
                      style={{
                        fontSize: 11.5,
                        color: C.textSub,
                        marginTop: 2,
                        display: "flex",
                        gap: 8,
                        alignItems: "center",
                        flexWrap: "wrap",
                      }}
                    >
                      <span style={{ color: agent.color, fontWeight: 600 }}>{agent.name}</span>
                      <span style={{ color: C.textMute }}>·</span>
                      <span style={{ color: meta.color, fontWeight: 600 }}>
                        <Icon name={meta.icon as IconName} size={11} color={meta.color} /> {meta.name}
                      </span>
                      <span style={{ color: C.textMute }}>·</span>
                      <span>{formatRelative(g.ts)}</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <button
                      onClick={() =>
                        downloadText(
                          `livrables-${g.sessionTitle.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.md`,
                          exportSessionMarkdown(g.sessionTitle, agent.name, g.items),
                        )
                      }
                      title="Télécharger en Markdown"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        background: C.bg,
                        color: C.textSub,
                        border: `1px solid ${C.border}`,
                        borderRadius: 7,
                        padding: "5px 10px",
                        fontSize: 11.5,
                        fontWeight: 600,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      <Icon name="download" size={11} color={C.textSub} />
                      Export
                    </button>
                    <button
                      onClick={() => onOpenSession(g.sessionId)}
                      title="Ouvrir la session"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        background: C.navyLight,
                        color: C.navy,
                        border: `1px solid ${C.navyMid}`,
                        borderRadius: 7,
                        padding: "5px 10px",
                        fontSize: 11.5,
                        fontWeight: 700,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      Ouvrir
                      <Icon name="chevRight" size={10} color={C.navy} />
                    </button>
                  </div>
                </div>

                <div
                  style={{
                    background: agent.bg,
                    border: `1px solid ${agent.color}28`,
                    borderRadius: 8,
                    padding: "10px 12px",
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {g.items.map((it) => (
                      <div
                        key={it.id}
                        style={{
                          display: "flex",
                          gap: 7,
                          fontSize: 13,
                          color: C.text,
                          lineHeight: 1.5,
                        }}
                      >
                        <span style={{ color: agent.color, fontWeight: 800, flexShrink: 0 }}>→</span>
                        <span>{it.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
