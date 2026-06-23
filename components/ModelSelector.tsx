"use client";

import { useEffect, useRef, useState } from "react";
import { C } from "@/lib/design-tokens";
import {
  prettyModelName,
  providerPrivacyNote,
  type ModelProvider,
  type ModelStatus,
} from "@/lib/models";
import { Icon } from "./Icon";

// Sélecteur de modèle + explication « quelle IA répond ».
//
// Remplace l'ancien toggle ●/☁ cryptique : un bouton montre le modèle ACTIF
// (« Llama 3 · local »), et un popover détaille local vs cloud — nom réel du
// modèle, confidentialité, et le rôle de chaque modèle (chat / livrables / web).

const LOCAL_COLOR = "#16A34A";
const CLOUD_COLOR = "#6366F1";

interface ModelSelectorProps {
  status: ModelStatus | null;
  provider: ModelProvider;
  onChange: (p: ModelProvider) => void;
  onRefresh: () => void;
  refreshing?: boolean;
  compact?: boolean; // mobile : bouton réduit à l'essentiel
}

export function ModelSelector({
  status,
  provider,
  onChange,
  onRefresh,
  refreshing = false,
  compact = false,
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Ferme le popover au clic en dehors / Échap.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const ollamaUp = status?.available ?? false;
  const cloudReady = status?.cloud.configured ?? false;
  const isLocal = provider === "local";
  const activeColor = isLocal ? LOCAL_COLOR : CLOUD_COLOR;

  // Nom du modèle de conversation actuellement en service.
  const activeModelId = isLocal ? status?.local.chat : status?.cloud.chat;
  const activeName = activeModelId ? prettyModelName(activeModelId) : isLocal ? "Local" : "Cloud";
  // Drapeau : local choisi mais Ollama injoignable → on prévient.
  const localBroken = isLocal && status !== null && !ollamaUp;

  const pick = (p: ModelProvider) => {
    if (p === "local" && !ollamaUp) {
      onRefresh(); // re-vérifie Ollama ; bascule si dispo (géré par le parent)
      return;
    }
    onChange(p);
    setOpen(false);
  };

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Voir / changer le modèle IA"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          border: `1.5px solid ${localBroken ? "#FED7AA" : activeColor + "55"}`,
          background: localBroken ? "#FFF7ED" : activeColor + "12",
          color: localBroken ? "#C2410C" : activeColor,
          borderRadius: 100,
          padding: compact ? "6px 8px" : "5px 11px",
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 700,
          fontFamily: "inherit",
          transition: "all 0.15s",
        }}
      >
        <Icon
          name={isLocal ? "laptop" : "globe"}
          size={13}
          color={localBroken ? "#C2410C" : activeColor}
        />
        {!compact && (
          <>
            {status === null ? "Vérification…" : localBroken ? "Local indispo" : activeName}
            <Icon name="chevDown" size={12} color={localBroken ? "#C2410C" : activeColor} />
          </>
        )}
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            width: 290,
            background: C.white,
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            boxShadow: "0 10px 30px rgba(0,0,0,0.12)",
            padding: 8,
            zIndex: 50,
          }}
        >
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 800,
              color: C.textMute,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              padding: "4px 6px 8px",
            }}
          >
            Quelle IA vous répond
          </div>

          <ProviderOption
            color={LOCAL_COLOR}
            icon="laptop"
            title="Modèle local"
            active={isLocal && ollamaUp}
            disabled={false}
            statusNote={
              status === null
                ? "Vérification d'Ollama…"
                : ollamaUp
                  ? "Ollama détecté"
                  : "Ollama non détecté — cliquez pour re-vérifier"
            }
            statusOk={ollamaUp}
            modelName={status ? prettyModelName(status.local.chat) : "—"}
            roles={
              status
                ? [
                    ["Livrables", prettyModelName(status.local.artifact)],
                    ["Recherche web", prettyModelName(status.local.tool)],
                  ]
                : []
            }
            privacyNote={providerPrivacyNote("local")}
            refreshing={refreshing}
            onClick={() => pick("local")}
          />

          <div style={{ height: 6 }} />

          <ProviderOption
            color={CLOUD_COLOR}
            icon="globe"
            title="Mistral Cloud"
            active={!isLocal}
            disabled={!cloudReady}
            statusNote={cloudReady ? "Secours · API Europe" : "Clé API non configurée"}
            statusOk={cloudReady}
            modelName={status ? prettyModelName(status.cloud.chat) : "—"}
            roles={status ? [["Livrables", prettyModelName(status.cloud.artifact)]] : []}
            privacyNote={providerPrivacyNote("cloud")}
            onClick={() => cloudReady && pick("cloud")}
          />
        </div>
      )}
    </div>
  );
}

function ProviderOption({
  color,
  icon,
  title,
  active,
  disabled,
  statusNote,
  statusOk,
  modelName,
  roles,
  privacyNote,
  refreshing = false,
  onClick,
}: {
  color: string;
  icon: "laptop" | "globe";
  title: string;
  active: boolean;
  disabled: boolean;
  statusNote: string;
  statusOk: boolean;
  modelName: string;
  roles: [string, string][];
  privacyNote: string;
  refreshing?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        background: active ? color + "10" : "transparent",
        border: `1.5px solid ${active ? color + "55" : C.border}`,
        borderRadius: 10,
        padding: "10px 11px",
        cursor: disabled ? "default" : "pointer",
        fontFamily: "inherit",
        opacity: disabled ? 0.55 : 1,
        transition: "all 0.12s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Icon name={icon} size={14} color={color} />
        <span style={{ fontSize: 12.5, fontWeight: 800, color: C.text }}>{title}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color, marginLeft: "auto" }}>{modelName}</span>
        {active && <Icon name="check" size={13} color={color} />}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: roles.length ? 6 : 0 }}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: statusOk ? "#16A34A" : "#CBD5E1",
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: 11, color: C.textSub }}>
          {refreshing ? "Vérification…" : statusNote}
        </span>
      </div>
      {roles.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
          {roles.map(([role, name]) => (
            <span
              key={role}
              style={{
                fontSize: 10,
                color: C.textSub,
                background: C.bg,
                borderRadius: 5,
                padding: "2px 6px",
              }}
            >
              {role} : <strong style={{ color: C.text, fontWeight: 700 }}>{name}</strong>
            </span>
          ))}
        </div>
      )}
      <div style={{ fontSize: 10.5, color: C.textMute, lineHeight: 1.45 }}>{privacyNote}</div>
    </button>
  );
}
