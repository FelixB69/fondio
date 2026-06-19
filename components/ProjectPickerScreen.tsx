"use client";

import { useCallback, useEffect, useState } from "react";
import { PROJECT_TYPES, ProjectType } from "@/lib/data";
import { C } from "@/lib/design-tokens";
import { STAGES } from "@/lib/projects";
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
}: {
  onPickProject: (projectId: string, type: ProjectType) => void;
  onSkip: () => void;
}) {
  const isMobile = useIsMobile();
  const supabase = createClient();
  const [projects, setProjects] = useState<PickerProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

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

  const createProject = async (input: NewProjectInput) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
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
    if (!error && data) {
      setShowNew(false);
      onPickProject(data.id, input.project_type);
    }
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
            Sur quel projet voulez-vous avancer ?
          </h1>
          <p style={{ margin: 0, color: C.textSub, fontSize: 14.5, lineHeight: 1.55 }}>
            Rattachez votre session à un projet pour suivre votre progression par paliers : {STAGES.map((s) => s.name).join(" → ")}.
          </p>
        </div>

        {loading && <div style={{ textAlign: "center", color: C.textMute, fontSize: 13 }}>Chargement…</div>}

        {!loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
            {projects.map((p) => {
              const meta = PROJECT_TYPES[p.project_type];
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

            {!loading && projects.length === 0 && (
              <div
                style={{
                  textAlign: "center",
                  color: C.textMute,
                  fontSize: 13.5,
                  padding: "8px 0 4px",
                }}
              >
                Pas encore de projet.
              </div>
            )}
          </div>
        )}

        <button
          onClick={() => setShowNew(true)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            width: "100%",
            background: C.navy,
            color: "white",
            border: "none",
            borderRadius: 10,
            padding: "12px 16px",
            fontSize: 13.5,
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "inherit",
            marginBottom: 18,
          }}
        >
          <Icon name="plus" size={13} color="white" />
          Nouveau projet
        </button>

        <div style={{ textAlign: "center" }}>
          <button
            onClick={onSkip}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: C.textMute,
              fontSize: 12.5,
              fontWeight: 600,
              fontFamily: "inherit",
              padding: 4,
            }}
          >
            Continuer sans projet →
          </button>
        </div>
      </div>

      {showNew && <NewProjectModal onClose={() => setShowNew(false)} onCreate={createProject} />}
    </div>
  );
}
