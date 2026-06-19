"use client";

import { useState } from "react";
import { AGENTS, AgentId, PROJECT_TYPES, ProjectType } from "@/lib/data";
import { C } from "@/lib/design-tokens";
import { useIsMobile } from "@/lib/use-responsive";
import { Icon, IconName } from "./Icon";

export function AgentSelector({
  type,
  onSelect,
  onBack,
}: {
  type: ProjectType;
  onSelect: (agentId: AgentId | AgentId[]) => void;
  onBack: () => void;
}) {
  const isMobile = useIsMobile();
  const [isPanelMode, setIsPanelMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<AgentId[]>([]);
  const meta = PROJECT_TYPES[type];

  const toggleAgent = (id: AgentId) => {
    setSelectedIds((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length < 4
          ? [...prev, id]
          : prev,
    );
  };

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        padding: isMobile ? "16px 16px 24px" : "32px 32px 24px",
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
        {/* Header */}
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
            <Icon name={meta.icon as IconName} size={12} color={meta.color} />
            {meta.name}
          </div>
          <h1
            style={{
              margin: "0 0 6px",
              fontSize: isMobile ? 22 : 26,
              fontWeight: 800,
              color: C.text,
              letterSpacing: "-0.03em",
            }}
          >
            Choisissez {isPanelMode ? "vos agents pour le panel" : "votre agent conseiller"}
          </h1>
          <p style={{ margin: 0, color: C.textSub, fontSize: 14 }}>
            {isPanelMode
              ? "Sélectionnez 2 à 4 agents. Ils débattront et se challengeront mutuellement."
              : "Chaque agent a sa spécialité et son style. Vous pouvez en changer à tout moment."}
          </p>
        </div>

        {/* Toggle mode */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 20,
            padding: "12px 16px",
            background: C.white,
            border: `1.5px solid ${isPanelMode ? "#7C3AED" : C.border}`,
            borderRadius: 12,
            transition: "border-color 0.2s",
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 9,
              background: isPanelMode ? "#F5F0FF" : C.bg,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
              flexShrink: 0,
              transition: "background 0.2s",
            }}
          >
            {isPanelMode ? <Icon name="sparkles" size={18} /> : <Icon name="target" size={18} />}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: C.text }}>
              {isPanelMode ? "Mode Panel activé" : "Mode simple"}
            </div>
            <div style={{ fontSize: 12, color: C.textSub }}>
              {isPanelMode
                ? "Les agents se parlent et se challengent · Synthèse à la fin"
                : "Un agent dédié à votre session"}
            </div>
          </div>
          <button
            onClick={() => {
              setIsPanelMode((p) => !p);
              setSelectedIds([]);
            }}
            style={{
              width: 44,
              height: 24,
              borderRadius: 100,
              background: isPanelMode ? "#7C3AED" : C.border,
              border: "none",
              cursor: "pointer",
              position: "relative",
              transition: "background 0.2s",
              flexShrink: 0,
            }}
          >
            <span
              style={{
                position: "absolute",
                top: 3,
                left: isPanelMode ? 23 : 3,
                width: 18,
                height: 18,
                borderRadius: "50%",
                background: "white",
                transition: "left 0.2s",
                boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
              }}
            />
          </button>
        </div>

        {/* Agent grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(240px, 1fr))",
            gap: 14,
          }}
        >
          {meta.agentIds.map((id) => {
            const agent = AGENTS[id];
            const isSelected = selectedIds.includes(id);

            return (
              <button
                key={id}
                onClick={() => {
                  if (isPanelMode) {
                    toggleAgent(id);
                  } else {
                    onSelect(id);
                  }
                }}
                style={{
                  background: isSelected ? agent.bg : C.white,
                  border: `1.5px solid ${isSelected ? agent.color : C.border}`,
                  borderRadius: 12,
                  padding: 18,
                  cursor: "pointer",
                  textAlign: "left",
                  fontFamily: "inherit",
                  transition: "all 0.15s",
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  position: "relative",
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.borderColor = agent.color;
                    e.currentTarget.style.boxShadow = C.shadowMd;
                    e.currentTarget.style.transform = "translateY(-2px)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.borderColor = C.border;
                    e.currentTarget.style.boxShadow = "none";
                    e.currentTarget.style.transform = "translateY(0)";
                  }
                }}
              >
                {/* Checkbox panel mode */}
                {isPanelMode && (
                  <div
                    style={{
                      position: "absolute",
                      top: 12,
                      right: 12,
                      width: 20,
                      height: 20,
                      borderRadius: 6,
                      border: `2px solid ${isSelected ? agent.color : C.border}`,
                      background: isSelected ? agent.color : "white",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      transition: "all 0.15s",
                    }}
                  >
                    {isSelected && <Icon name="check" size={11} color="white" />}
                  </div>
                )}

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
                    <Icon name={agent.icon as IconName} size={18} color={agent.color} />
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
                      {agent.firstName}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 3 }}>
                      <span style={{ fontSize: 11, color: agent.color, fontWeight: 600 }}>
                        {agent.name}
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

        {/* Panel CTA */}
        {isPanelMode && (
          <div
            style={{
              marginTop: 20,
              padding: "14px 16px",
              background: C.white,
              border: `1.5px solid ${selectedIds.length >= 2 ? "#7C3AED" : C.border}`,
              borderRadius: 12,
              display: "flex",
              alignItems: "center",
              gap: 12,
              transition: "border-color 0.2s",
            }}
          >
            {/* Agent chips */}
            <div style={{ flex: 1, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {selectedIds.length === 0 ? (
                <span style={{ fontSize: 13, color: C.textMute }}>
                  Sélectionne 2 à 4 agents…
                </span>
              ) : (
                selectedIds.map((id) => {
                  const agent = AGENTS[id];
                  return (
                    <span
                      key={id}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        background: agent.bg,
                        color: agent.color,
                        border: `1px solid ${agent.color}40`,
                        borderRadius: 100,
                        padding: "3px 10px 3px 7px",
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      <Icon name={agent.icon as IconName} size={12} color={agent.color} /> {agent.name}
                    </span>
                  );
                })
              )}
            </div>
            <button
              onClick={() => selectedIds.length >= 2 && onSelect(selectedIds)}
              disabled={selectedIds.length < 2}
              style={{
                background: selectedIds.length >= 2 ? "#7C3AED" : C.border,
                color: "white",
                border: "none",
                borderRadius: 9,
                padding: "10px 18px",
                fontSize: 13,
                fontWeight: 700,
                cursor: selectedIds.length >= 2 ? "pointer" : "default",
                fontFamily: "inherit",
                transition: "background 0.2s",
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                gap: 7,
              }}
            >
              ✨ Lancer le panel
              {selectedIds.length >= 2 && (
                <span
                  style={{
                    background: "rgba(255,255,255,0.25)",
                    borderRadius: 100,
                    padding: "1px 7px",
                    fontSize: 11,
                  }}
                >
                  {selectedIds.length}
                </span>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
