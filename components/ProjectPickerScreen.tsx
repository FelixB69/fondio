"use client";

import { useCallback, useEffect, useState } from "react";
import { PROJECT_TYPES, ProjectType } from "@/lib/data";
import { C } from "@/lib/design-tokens";
import { createClient } from "@/lib/supabase/client";
import { useIsMobile } from "@/lib/use-responsive";
import { Icon, IconName } from "./Icon";
import { NewProjectInput, NewProjectModal } from "./ProjectsScreen";

interface PickerProject {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  project_type: ProjectType;
}

export function ProjectPickerScreen({
  onPickProject,
  onSkip,
  onGuidedStart,
}: {
  onPickProject: (projectId: string, type: ProjectType) => void;
  onSkip: () => void;
  // Mode Accompagné : l'utilisateur décrit son projet, on ouvre une session
  // guidée avec Clara. Aucun projet n'est créé à ce stade (cf. bandeau de
  // matérialisation dans le chat).
  onGuidedStart: (description: string) => Promise<void>;
}) {
  const isMobile = useIsMobile();
  const supabase = createClient();
  const [projects, setProjects] = useState<PickerProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [description, setDescription] = useState("");
  const [starting, setStarting] = useState(false);

  const submitGuided = async () => {
    const text = description.trim();
    if (!text || starting) return;
    setStarting(true);
    await onGuidedStart(text);
    setStarting(false);
  };

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("projects")
      .select("id, name, icon, color, project_type")
      .order("updated_at", { ascending: false });
    setProjects((data ?? []) as PickerProject[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const createProject = async (input: NewProjectInput): Promise<string | null> => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return "Vous devez être connecté pour créer un projet.";
    const { data, error } = await supabase
      .from("projects")
      .insert({
        user_id: user.id,
        name: input.name.trim(),
        icon: input.icon,
        color: input.color,
        project_type: input.project_type,
      })
      .select("id")
      .single();
    if (error) return error.message;
    if (data) {
      setShowNew(false);
      onPickProject(data.id, input.project_type);
    }
    return null;
  };

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        padding: isMobile ? "24px 16px" : 32,
        background: C.bg,
        animation: "fndFadeIn 0.22s ease",
        overflowY: "auto",
      }}
    >
      <div style={{ width: "100%", maxWidth: 720, margin: "auto" }}>
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
            <Icon name="target" size={22} color="white" />
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
            Sur quoi voulez-vous avancer ?
          </h1>
          <p style={{ margin: 0, color: C.textSub, fontSize: 14.5, lineHeight: 1.55 }}>
            Décrivez votre projet en quelques lignes. On vous met en relation avec le bon
            expert, et on passe la main aux autres au fil de la conversation.
          </p>
        </div>

        {/* Mode Accompagné — point d'entrée par défaut. */}
        <div
          style={{
            background: C.white,
            border: `1.5px solid ${C.border}`,
            borderRadius: 14,
            padding: isMobile ? 14 : 18,
            boxShadow: C.shadow,
            marginBottom: 24,
          }}
        >
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitGuided();
            }}
            placeholder="Ex : je veux une appli pour réserver des cours de yoga en ligne, avec paiement. Je ne sais pas coder."
            rows={4}
            autoFocus
            style={{
              width: "100%",
              border: "none",
              outline: "none",
              resize: "vertical",
              fontSize: 14,
              lineHeight: 1.6,
              fontFamily: "inherit",
              color: C.text,
              background: "transparent",
              boxSizing: "border-box",
              minHeight: 84,
            }}
          />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              borderTop: `1px solid ${C.border}`,
              paddingTop: 12,
              marginTop: 6,
            }}
          >
            <span style={{ fontSize: 11.5, color: C.textMute }}>
              Plus vous donnez de contexte, plus l&apos;accompagnement est utile.
            </span>
            <button
              onClick={submitGuided}
              disabled={!description.trim() || starting}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                background: description.trim() && !starting ? C.navy : C.border,
                color: "white",
                border: "none",
                borderRadius: 10,
                padding: "10px 18px",
                fontSize: 13.5,
                fontWeight: 700,
                cursor: description.trim() && !starting ? "pointer" : "default",
                fontFamily: "inherit",
                flexShrink: 0,
                transition: "background 0.15s",
              }}
            >
              <Icon name="sparkles" size={14} color="white" />
              {starting ? "Ouverture…" : "C'est parti"}
            </button>
          </div>
        </div>

        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <button
            onClick={onSkip}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: C.textSub,
              fontSize: 12.5,
              fontWeight: 600,
              fontFamily: "inherit",
              padding: 4,
              textDecoration: "underline",
            }}
          >
            Je préfère choisir mes experts moi-même →
          </button>
        </div>

        {projects.length > 0 && (
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: C.textMute,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              marginBottom: 10,
            }}
          >
            Ou reprendre un projet
          </div>
        )}

        {loading && <div style={{ textAlign: "center", color: C.textMute, fontSize: 13 }}>Chargement…</div>}

        {!loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
            {projects.map((p) => {
              const meta = PROJECT_TYPES[p.project_type] ?? PROJECT_TYPES.other;
              return (
                <button
                  key={p.id}
                  onClick={() => onPickProject(p.id, p.project_type)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    background: C.white,
                    border: `1.5px solid ${C.border}`,
                    borderRadius: 12,
                    padding: "14px 16px",
                    cursor: "pointer",
                    textAlign: "left",
                    fontFamily: "inherit",
                    transition: "all 0.15s",
                    boxShadow: C.shadow,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = p.color ?? C.navy;
                    e.currentTarget.style.boxShadow = C.shadowMd;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = C.border;
                    e.currentTarget.style.boxShadow = C.shadow;
                  }}
                >
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 10,
                      background: p.color ?? meta.bg,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <Icon name={(p.icon ?? "target") as IconName} size={19} color="white" />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 800, color: C.text, letterSpacing: "-0.02em" }}>
                      {p.name}
                    </div>
                    <div
                      style={{
                        fontSize: 11.5,
                        color: meta.color,
                        fontWeight: 600,
                        marginTop: 2,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <Icon name={meta.icon as IconName} size={11} color={meta.color} />
                      {meta.name}
                    </div>
                  </div>
                  <Icon name="chevRight" size={14} color={C.textMute} />
                </button>
              );
            })}

          </div>
        )}

        {/* Création manuelle d'un projet, sans passer par l'accompagnement. */}
        <button
          onClick={() => setShowNew(true)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            width: "100%",
            background: C.white,
            color: C.navy,
            border: `1.5px solid ${C.navy}`,
            borderRadius: 10,
            padding: "11px 16px",
            fontSize: 13,
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          <Icon name="plus" size={13} color={C.navy} />
          Créer un projet vide
        </button>
      </div>

      {showNew && <NewProjectModal onClose={() => setShowNew(false)} onCreate={createProject} />}
    </div>
  );
}
