"use client";

import { AGENTS, AgentId, PROJECT_TYPES, ProjectType } from "@/lib/data";
import { C } from "@/lib/design-tokens";
import { Icon, IconName } from "./Icon";

export function AgentSelector({
  type,
  onSelect,
  onBack,
}: {
  type: ProjectType;
  onSelect: (agentId: AgentId) => void;
  onBack: () => void;
}) {
  const meta = PROJECT_TYPES[type];
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        padding: "32px 32px 24px",
        background: C.bg,
        overflowY: "auto",
        animation: "fndFadeIn 0.22s ease",
      }}
    >
      <button
        onClick={onBack}
        style={{
          alignSelf: "flex-start",
          background: "none",
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 6,
          color: C.textSub,
          fontSize: 13,
          marginBottom: 18,
          fontFamily: "inherit",
          padding: 0,
        }}
      >
        <Icon name="arrowLeft" size={14} color={C.textSub} /> Retour
      </button>

      <div style={{ width: "100%", maxWidth: 880, margin: "0 auto" }}>
        <div style={{ marginBottom: 22 }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: meta.bg,
              color: meta.color,
              padding: "4px 11px",
              borderRadius: 100,
              fontSize: 12,
              fontWeight: 700,
              marginBottom: 12,
            }}
          >
            <span>{meta.emoji}</span>
            {meta.name}
          </div>
          <h1
            style={{
              margin: "0 0 6px",
              fontSize: 26,
              fontWeight: 800,
              color: C.text,
              letterSpacing: "-0.03em",
            }}
          >
            Choisis ton agent conseiller
          </h1>
          <p style={{ margin: 0, color: C.textSub, fontSize: 14 }}>
            Chaque agent a sa spécialité et son style. Tu peux en changer à tout moment.
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
            gap: 14,
          }}
        >
          {meta.agentIds.map((id) => {
            const agent = AGENTS[id];
            return (
              <button
                key={id}
                onClick={() => onSelect(id)}
                style={{
                  background: C.white,
                  border: `1.5px solid ${C.border}`,
                  borderRadius: 12,
                  padding: 18,
                  cursor: "pointer",
                  textAlign: "left",
                  fontFamily: "inherit",
                  transition: "all 0.15s",
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = agent.color;
                  e.currentTarget.style.boxShadow = C.shadowMd;
                  e.currentTarget.style.transform = "translateY(-2px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = C.border;
                  e.currentTarget.style.boxShadow = "none";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 9,
                      background: agent.bg,
                      border: `1.5px solid ${agent.color}25`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 18,
                      flexShrink: 0,
                    }}
                  >
                    {agent.emoji}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 14.5,
                        fontWeight: 800,
                        color: C.text,
                        letterSpacing: "-0.02em",
                        lineHeight: 1.2,
                      }}
                    >
                      {agent.name}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 3 }}>
                      <Icon name={agent.icon as IconName} size={11} color={agent.color} />
                      <span style={{ fontSize: 11, color: agent.color, fontWeight: 600 }}>
                        Conseiller IA
                      </span>
                    </div>
                  </div>
                </div>

                <div style={{ fontSize: 12.5, color: C.textSub, lineHeight: 1.5, flex: 1 }}>
                  {agent.desc}
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {agent.tags.map((tag) => (
                    <span
                      key={tag}
                      style={{
                        fontSize: 10.5,
                        fontWeight: 600,
                        color: agent.color,
                        background: agent.bg,
                        padding: "2px 8px",
                        borderRadius: 100,
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
