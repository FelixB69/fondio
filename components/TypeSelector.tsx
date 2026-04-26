"use client";

import { PROJECT_TYPES, ProjectType } from "@/lib/data";
import { C } from "@/lib/design-tokens";
import { useIsMobile } from "@/lib/use-responsive";
import { Icon, IconName } from "./Icon";

export function TypeSelector({ onSelect }: { onSelect: (type: ProjectType) => void }) {
  const isMobile = useIsMobile();
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: isMobile ? "24px 16px" : 32,
        background: C.bg,
        animation: "fndFadeIn 0.22s ease",
        overflowY: "auto",
      }}
    >
      <div style={{ width: "100%", maxWidth: 720 }}>
        <div style={{ textAlign: "center", marginBottom: isMobile ? 24 : 36 }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 48,
              height: 48,
              borderRadius: 12,
              background: `linear-gradient(135deg, ${C.navy} 0%, #3a6bb5 100%)`,
              marginBottom: 18,
            }}
          >
            <Icon name="sparkles" size={22} color="white" />
          </div>
          <h1
            style={{
              margin: "0 0 8px",
              fontSize: 28,
              fontWeight: 800,
              color: C.text,
              letterSpacing: "-0.03em",
            }}
          >
            Sur quoi tu veux qu'on bosse ?
          </h1>
          <p style={{ margin: 0, color: C.textSub, fontSize: 14.5, lineHeight: 1.55 }}>
            Choisis le contexte de ton projet — ça conditionne les agents disponibles.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}>
          {(Object.values(PROJECT_TYPES) as Array<typeof PROJECT_TYPES.perso>).map((t) => (
            <button
              key={t.id}
              onClick={() => onSelect(t.id)}
              style={{
                background: C.white,
                border: `1.5px solid ${C.border}`,
                borderRadius: 14,
                padding: "26px 24px",
                cursor: "pointer",
                textAlign: "left",
                fontFamily: "inherit",
                transition: "all 0.15s",
                boxShadow: C.shadow,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = t.color;
                e.currentTarget.style.boxShadow = C.shadowMd;
                e.currentTarget.style.transform = "translateY(-2px)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = C.border;
                e.currentTarget.style.boxShadow = C.shadow;
                e.currentTarget.style.transform = "translateY(0)";
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 11,
                  background: t.bg,
                  border: `1.5px solid ${t.color}25`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 22,
                  marginBottom: 14,
                }}
              >
                <Icon name={t.icon as IconName} size={22} color={t.color} />
              </div>
              <div
                style={{
                  fontSize: 17,
                  fontWeight: 800,
                  color: C.text,
                  letterSpacing: "-0.02em",
                  marginBottom: 6,
                }}
              >
                {t.name}
              </div>
              <div style={{ fontSize: 13, color: C.textSub, lineHeight: 1.55, marginBottom: 16 }}>
                {t.tagline}
              </div>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12.5,
                  fontWeight: 700,
                  color: t.color,
                }}
              >
                Choisir
                <Icon name="chevRight" size={12} color={t.color} />
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
