"use client";

// Bouton de rattachement à un projet, partagé par l'en-tête du chat simple
// (ChatSession) et du panel (MultiAgentSession). Affiche le projet lié (picto
// coloré + nom) ou une invite « Rattacher à un projet » quand la session est libre.
import type { ProjectLite } from "./AppDataProvider";
import { C } from "@/lib/design-tokens";
import { Icon, IconName } from "./Icon";

export function ProjectLinkButton({
  project,
  isMobile,
  onClick,
}: {
  project: ProjectLite | null;
  isMobile: boolean;
  onClick: () => void;
}) {
  const linked = project !== null;
  return (
    <button
      onClick={onClick}
      title={linked ? `Projet : ${project.name} — cliquer pour changer` : "Rattacher cette session à un projet"}
      style={{
        display: "flex",
        alignItems: "center",
        gap: isMobile ? 0 : 7,
        maxWidth: isMobile ? undefined : 220,
        border: `1.5px solid ${linked ? C.navy : C.border}`,
        background: linked ? C.navyLight : C.white,
        color: linked ? C.navy : C.textSub,
        borderRadius: 100,
        padding: isMobile ? "6px" : "4px 12px 4px 5px",
        cursor: "pointer",
        fontSize: 12,
        fontWeight: 700,
        fontFamily: "inherit",
        transition: "all 0.15s",
        flexShrink: 0,
      }}
    >
      {linked ? (
        <span
          style={{
            width: 20,
            height: 20,
            borderRadius: 6,
            background: project.color ?? C.navy,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Icon name={(project.icon ?? "target") as IconName} size={12} color="white" />
        </span>
      ) : (
        <span style={{ display: "flex", padding: isMobile ? 0 : "0 0 0 4px" }}>
          <Icon name="folder" size={13} color={C.textSub} />
        </span>
      )}
      {!isMobile && (
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {linked ? project.name : "Rattacher à un projet"}
        </span>
      )}
    </button>
  );
}
