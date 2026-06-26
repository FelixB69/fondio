"use client";

import type { CSSProperties } from "react";
import Image from "next/image";
import { AGENTS, AgentId } from "@/lib/data";
import { C } from "@/lib/design-tokens";
import { useIsMobile } from "@/lib/use-responsive";
import { Icon, IconName } from "./Icon";

const FEATURES: { icon: IconName; title: string; desc: string }[] = [
  {
    icon: "zap",
    title: "Mode Challenger",
    desc: "Activez-le pour que l'agent challenge vos hypothèses et pointe vos angles morts au lieu de valider.",
  },
  {
    icon: "users",
    title: "Panel multi-agents",
    desc: "Réunissez plusieurs conseillers sur une même session pour croiser leurs points de vue et obtenir une synthèse.",
  },
  {
    icon: "msgSquare",
    title: "Sessions structurées",
    desc: "Chaque échange suit un fil clair — contexte, analyse, recommandations — au lieu d'une conversation qui s'éparpille.",
  },
];

const WORKSPACE_PILLARS: { icon: IconName; title: string; desc: string }[] = [
  {
    icon: "target",
    title: "Projets & paliers",
    desc: "Rattachez vos sessions à un projet et suivez sa progression par étapes, du brief au lancement.",
  },
  {
    icon: "tasks",
    title: "Tâches",
    desc: "Les actions issues de vos échanges deviennent des tâches concrètes que vous cochez au fil de l'eau.",
  },
  {
    icon: "clock",
    title: "Agenda",
    desc: "Planifiez les échéances de vos projets et gardez une vue claire de ce qui arrive.",
  },
  {
    icon: "word",
    title: "Livrables",
    desc: "Chaque échange produit des livrables structurés — tableaux, documents — exportables en PDF ou Word.",
  },
];

const FEATURED_AGENT_IDS: AgentId[] = ["strategist", "analyst", "mentor", "coach", "cto", "creative"];

export function LandingScreen({
  onLogin,
  onSignup,
}: {
  onLogin: () => void;
  onSignup: () => void;
}) {
  const isMobile = useIsMobile();

  const primaryBtn: CSSProperties = {
    padding: "13px 26px",
    background: C.navy,
    color: "white",
    border: "none",
    borderRadius: 10,
    fontSize: 14.5,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
  };

  const secondaryBtn: CSSProperties = {
    padding: "13px 26px",
    background: "transparent",
    color: C.navy,
    border: `1.5px solid ${C.navyMid}`,
    borderRadius: 10,
    fontSize: 14.5,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
  };

  return (
    <div style={{ width: "100vw", height: "100dvh", overflowY: "auto", background: C.white }}>
      {/* Hero */}
      <div
        style={{
          background: `linear-gradient(160deg, #1a3260 0%, ${C.navy} 50%, #1e4d7a 100%)`,
          padding: isMobile ? "32px 20px 44px" : "28px 40px 60px",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -100,
            right: -100,
            width: 320,
            height: 320,
            borderRadius: "50%",
            background: `${C.mint}14`,
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -120,
            left: -80,
            width: 280,
            height: 280,
            borderRadius: "50%",
            background: `${C.pink}10`,
          }}
        />

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            position: "relative",
            maxWidth: 980,
            margin: "0 auto",
          }}
        >
          <Image src="/fondio-logo.png" alt="Fondio" width={790} height={272} priority style={{ height: 60, width: "auto", display: "block" }} />
          {!isMobile && (
            <button onClick={onLogin} style={{ ...secondaryBtn, padding: "9px 20px", borderColor: "rgba(255,255,255,0.3)", color: "white" }}>
              Se connecter
            </button>
          )}
        </div>

        <div
          style={{
            position: "relative",
            maxWidth: 720,
            margin: isMobile ? "40px auto 0" : "64px auto 0",
            textAlign: "center",
          }}
        >
          <h1
            style={{
              margin: "0 0 16px",
              fontSize: isMobile ? 28 : 38,
              fontWeight: 800,
              color: "white",
              letterSpacing: "-0.03em",
              lineHeight: 1.2,
            }}
          >
            Des conseillers IA spécialisés pour avancer sur vos projets
          </h1>
          <p
            style={{
              margin: "0 auto 28px",
              fontSize: isMobile ? 14.5 : 16,
              color: "rgba(255,255,255,0.65)",
              lineHeight: 1.6,
              maxWidth: 560,
            }}
          >
            Choisissez un conseiller IA spécialisé, démarrez une session structurée — puis pilotez la suite
            au même endroit : projets, tâches, agenda et livrables. Un espace de travail complet, pas juste une conversation.
          </p>
          <div style={{ display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap" }}>
            <button onClick={onSignup} style={primaryBtn}>
              Créer un compte →
            </button>
            {isMobile && (
              <button onClick={onLogin} style={{ ...secondaryBtn, borderColor: "rgba(255,255,255,0.3)", color: "white" }}>
                Se connecter
              </button>
            )}
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: 8,
              flexWrap: "wrap",
              marginTop: 22,
            }}
          >
            {[
              { icon: "target" as IconName, label: "Projets" },
              { icon: "tasks" as IconName, label: "Tâches" },
              { icon: "clock" as IconName, label: "Agenda" },
              { icon: "word" as IconName, label: "Livrables" },
            ].map((p) => (
              <span
                key={p.label}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 12px",
                  borderRadius: 100,
                  background: "rgba(255,255,255,0.10)",
                  border: "1px solid rgba(255,255,255,0.18)",
                  color: "rgba(255,255,255,0.92)",
                  fontSize: 12.5,
                  fontWeight: 600,
                }}
              >
                <Icon name={p.icon} size={13} color="rgba(255,255,255,0.92)" />
                {p.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Agents */}
      <div style={{ maxWidth: 980, margin: "0 auto", padding: isMobile ? "36px 20px 8px" : "56px 40px 8px" }}>
        <h2
          style={{
            margin: "0 0 6px",
            fontSize: isMobile ? 19 : 22,
            fontWeight: 800,
            color: C.text,
            letterSpacing: "-0.02em",
            textAlign: "center",
          }}
        >
          Un agent pour chaque besoin
        </h2>
        <p style={{ margin: "0 0 28px", color: C.textSub, fontSize: 14, textAlign: "center" }}>
          4 conseillers pro, 5 conseillers perso — chacun avec son propre angle d'expertise.
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(3, 1fr)",
            gap: 12,
          }}
        >
          {FEATURED_AGENT_IDS.map((id) => {
            const agent = AGENTS[id];
            return (
              <div
                key={id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  background: C.bg,
                  border: `1px solid ${C.border}`,
                  borderRadius: 12,
                  padding: "12px 14px",
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: agent.bg,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <Icon name={agent.icon as IconName} size={15} color={agent.color} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{agent.name}</div>
                  <div
                    style={{
                      fontSize: 11,
                      color: C.textSub,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {agent.desc}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Espace de travail */}
      <div style={{ maxWidth: 980, margin: "0 auto", padding: isMobile ? "36px 20px 8px" : "56px 40px 8px" }}>
        <h2
          style={{
            margin: "0 0 6px",
            fontSize: isMobile ? 19 : 22,
            fontWeight: 800,
            color: C.text,
            letterSpacing: "-0.02em",
            textAlign: "center",
          }}
        >
          Un espace de travail complet, pas juste un chat
        </h2>
        <p style={{ margin: "0 0 28px", color: C.textSub, fontSize: 14, textAlign: "center" }}>
          Vos conseils se transforment en projets pilotés — tâches, échéances et livrables réunis au même endroit.
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)",
            gap: 12,
          }}
        >
          {WORKSPACE_PILLARS.map((p) => (
            <div
              key={p.title}
              style={{
                background: C.bg,
                border: `1px solid ${C.border}`,
                borderRadius: 12,
                padding: "16px 16px",
              }}
            >
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  background: C.navyLight,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 12,
                }}
              >
                <Icon name={p.icon} size={17} color={C.navy} />
              </div>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: C.text, marginBottom: 6 }}>{p.title}</div>
              <div style={{ fontSize: 13, color: C.textSub, lineHeight: 1.55 }}>{p.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Features — Conseil IA */}
      <div style={{ maxWidth: 980, margin: "0 auto", padding: isMobile ? "36px 20px" : "56px 40px" }}>
        <h2
          style={{
            margin: "0 0 6px",
            fontSize: isMobile ? 19 : 22,
            fontWeight: 800,
            color: C.text,
            letterSpacing: "-0.02em",
            textAlign: "center",
          }}
        >
          Un conseil IA qui va au fond des choses
        </h2>
        <p style={{ margin: "0 0 28px", color: C.textSub, fontSize: 14, textAlign: "center" }}>
          Pas un simple chatbot : des conseillers qui structurent, challengent et croisent les points de vue.
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)",
            gap: 16,
          }}
        >
          {FEATURES.map((f) => (
            <div key={f.title}>
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  background: C.navyLight,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 12,
                }}
              >
                <Icon name={f.icon} size={17} color={C.navy} />
              </div>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: C.text, marginBottom: 6 }}>{f.title}</div>
              <div style={{ fontSize: 13, color: C.textSub, lineHeight: 1.55 }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* CTA footer */}
      <div
        style={{
          maxWidth: 980,
          margin: "0 auto",
          padding: isMobile ? "8px 20px 48px" : "8px 40px 64px",
          textAlign: "center",
        }}
      >
        <button onClick={onSignup} style={primaryBtn}>
          Créer un compte gratuitement →
        </button>
        <div style={{ marginTop: 14, fontSize: 12.5, color: C.textMute }}>
          Déjà inscrit ?{" "}
          <button
            onClick={onLogin}
            style={{ background: "none", border: "none", color: C.navy, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: 12.5 }}
          >
            Se connecter
          </button>
        </div>
      </div>
    </div>
  );
}
