"use client";

import { useState } from "react";
import { C } from "@/lib/design-tokens";
import { useIsMobile } from "@/lib/use-responsive";
import { Icon, IconName } from "./Icon";

const STEPS: { icon: IconName; title: string; desc: string }[] = [
  {
    icon: "target",
    title: "1. Choisissez un projet",
    desc: "Créez un projet tech (site web, appli, IA, script...) : c'est le cœur de votre espace de travail, où se rassemblent sessions, tâches, agenda et livrables. Ou continuez sans projet pour une session ponctuelle.",
  },
  {
    icon: "sparkles",
    title: "2. Sélectionnez un agent",
    desc: "Malik pour la technique, Clara pour le pilotage, Jade pour vos utilisateurs, Sam pour tout vous expliquer... six conseillers, chacun avec son angle. Vous pouvez aussi en réunir plusieurs en panel.",
  },
  {
    icon: "msgSquare",
    title: "3. Discutez et obtenez des livrables",
    desc: "L'agent répond avec un texte structuré et, dès que c'est pertinent, un bloc Livrables concret — exportable en PDF ou Word.",
  },
  {
    icon: "tasks",
    title: "4. Suivez vos tâches et votre agenda",
    desc: "Tout est réuni au même endroit : les actions issues de vos sessions deviennent des tâches, vos échéances se posent dans l'Agenda, et vos livrables restent à portée. Fondio n'est pas qu'un chat — c'est votre espace de travail.",
  },
];

const STORAGE_KEY = "fondio_onboarding_seen";

export function hasSeenOnboarding(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(STORAGE_KEY) === "1";
}

function markOnboardingSeen() {
  if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, "1");
}

export function OnboardingTour({ onDone }: { onDone: () => void }) {
  const isMobile = useIsMobile();
  const [step, setStep] = useState(0);
  const isLast = step === STEPS.length - 1;
  const current = STEPS[step];

  const finish = () => {
    markOnboardingSeen();
    onDone();
  };

  const primaryBtn = {
    padding: "11px 22px",
    background: C.navy,
    color: "white",
    border: "none",
    borderRadius: 9,
    fontSize: 13.5,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
  } as const;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: "rgba(15,23,42,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        animation: "fndFadeIn 0.15s ease",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: C.white,
          borderRadius: 18,
          padding: isMobile ? 24 : 28,
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
        }}
      >
        <button
          onClick={finish}
          style={{
            float: "right",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 4,
            display: "flex",
            color: C.textMute,
          }}
          aria-label="Passer la visite guidée"
        >
          <Icon name="close" size={16} color={C.textMute} />
        </button>

        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: C.navyLight,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 18,
          }}
        >
          <Icon name={current.icon} size={22} color={C.navy} />
        </div>

        <h2
          style={{
            margin: "0 0 8px",
            fontSize: 19,
            fontWeight: 800,
            color: C.text,
            letterSpacing: "-0.02em",
          }}
        >
          {current.title}
        </h2>
        <p style={{ margin: "0 0 24px", fontSize: 14, color: C.textSub, lineHeight: 1.6, minHeight: 56 }}>
          {current.desc}
        </p>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 6 }}>
            {STEPS.map((_, i) => (
              <div
                key={i}
                style={{
                  width: i === step ? 18 : 6,
                  height: 6,
                  borderRadius: 3,
                  background: i === step ? C.navy : C.border,
                  transition: "all 0.2s",
                }}
              />
            ))}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            {step > 0 && (
              <button
                onClick={() => setStep((s) => s - 1)}
                style={{
                  padding: "11px 16px",
                  background: "none",
                  border: "none",
                  color: C.textSub,
                  fontSize: 13.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Retour
              </button>
            )}
            <button onClick={isLast ? finish : () => setStep((s) => s + 1)} style={primaryBtn}>
              {isLast ? "Commencer →" : "Suivant →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
