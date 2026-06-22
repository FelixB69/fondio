"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { PROJECT_TYPES } from "@/lib/data";
import { C } from "@/lib/design-tokens";
import { createClient } from "@/lib/supabase/client";
import { useAppData } from "./AppDataProvider";
import { Icon, IconName } from "./Icon";
import { NewProjectInput, NewProjectModal } from "./ProjectsScreen";

export function LinkSessionModal({
  sessionId,
  currentProjectId,
  onClose,
  onLinked,
}: {
  sessionId: string;
  currentProjectId: string | null;
  onClose: () => void;
  onLinked: (projectId: string | null) => void;
}) {
  const supabase = createClient();
  // Source de vérité unique : les projets viennent du provider, partagés avec le
  // header de chat et la sidebar. On rafraîchit à l'ouverture du modal.
  const { projects, loadProjects } = useAppData();
  const [saving, setSaving] = useState(false);
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const link = async (projectId: string | null) => {
    if (saving) return;
    setSaving(true);
    const { error } = await supabase
      .from("sessions")
      .update({ project_id: projectId })
      .eq("id", sessionId);
    if (!error) {
      // Les tâches déjà issues de cette session gardent un snapshot du
      // project_id pris à leur création : on le réaligne ici, sinon elles
      // restent « Sans projet » dans l'agenda et les projets après coup.
      await supabase
        .from("tasks")
        .update({ project_id: projectId })
        .eq("session_id", sessionId);
    }
    setSaving(false);
    if (error) return;
    onLinked(projectId);
  };

  // Crée un projet à la volée puis rattache la session dessus — pas de
  // cul-de-sac quand l'utilisateur n'a encore aucun projet.
  const createAndLink = async (input: NewProjectInput) => {
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
    if (error || !data) return;
    await loadProjects();
    setShowNew(false);
    await link(data.id as string);
  };

  const overlay: CSSProperties = {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.45)",
    zIndex: 200,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    animation: "fndFadeIn 0.15s ease",
  };

  const modal: CSSProperties = {
    background: C.white,
    borderRadius: 14,
    padding: "20px 22px",
    width: "100%",
    maxWidth: 440,
    maxHeight: "80vh",
    display: "flex",
    flexDirection: "column",
    boxShadow: C.shadowMd,
  };

  return (
    <>
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: C.text, letterSpacing: "-0.02em" }}>
            Rattacher à un projet
          </h2>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: C.textMute, display: "flex" }}
          >
            <Icon name="close" size={16} color={C.textMute} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
          {/* "Aucun" : détache la session de tout projet */}
          <button
            onClick={() => link(null)}
            disabled={saving}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              width: "100%",
              padding: "10px 12px",
              background: currentProjectId === null ? C.navyLight : C.bg,
              border: `1.5px solid ${currentProjectId === null ? C.navy : C.border}`,
              borderRadius: 9,
              cursor: saving ? "default" : "pointer",
              fontFamily: "inherit",
              textAlign: "left",
              opacity: saving ? 0.6 : 1,
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: C.white,
                border: `1.5px dashed ${C.border}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                color: C.textMute,
              }}
            >
              <Icon name="close" size={14} color={C.textMute} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: C.text }}>
                Aucun projet
              </div>
              <div style={{ fontSize: 11.5, color: C.textSub, marginTop: 2 }}>
                Session libre, ne contribue à aucune progression.
              </div>
            </div>
            {currentProjectId === null && <Icon name="check" size={14} color={C.navy} />}
          </button>

          {projects.length === 0 && (
            <div
              style={{
                color: C.textMute,
                fontSize: 12.5,
                lineHeight: 1.5,
                padding: "16px 12px",
                textAlign: "center",
                background: C.bg,
                borderRadius: 9,
                marginTop: 4,
              }}
            >
              Pas encore de projet. Créez-en un ci-dessous pour y rattacher cette session.
            </div>
          )}

          {projects.map((p) => {
            const meta = PROJECT_TYPES[p.project_type];
            const active = currentProjectId === p.id;
            return (
              <button
                key={p.id}
                onClick={() => link(p.id)}
                disabled={saving}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  width: "100%",
                  padding: "10px 12px",
                  background: active ? C.navyLight : C.white,
                  border: `1.5px solid ${active ? C.navy : C.border}`,
                  borderRadius: 9,
                  cursor: saving ? "default" : "pointer",
                  fontFamily: "inherit",
                  textAlign: "left",
                  opacity: saving ? 0.6 : 1,
                  transition: "background 0.12s, border-color 0.12s",
                }}
                onMouseEnter={(e) => {
                  if (!active && !saving) {
                    e.currentTarget.style.background = C.bg;
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active && !saving) {
                    e.currentTarget.style.background = C.white;
                  }
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: p.color ?? meta.bg,
                    border: "none",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <Icon name={(p.icon ?? "target") as IconName} size={16} color="white" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13.5,
                      fontWeight: 700,
                      color: C.text,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {p.name}
                  </div>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: meta.color,
                      marginTop: 2,
                      fontWeight: 600,
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <Icon name={meta.icon as IconName} size={11} color={meta.color} />
                    {meta.name}
                  </div>
                </div>
                {active && <Icon name="check" size={14} color={C.navy} />}
              </button>
            );
          })}
        </div>

        {/* Créer un projet sans quitter le flux de rattachement */}
        <button
          onClick={() => setShowNew(true)}
          disabled={saving}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            width: "100%",
            marginTop: 12,
            background: C.white,
            color: C.navy,
            border: `1.5px solid ${C.navy}`,
            borderRadius: 9,
            padding: "10px 12px",
            fontSize: 13,
            fontWeight: 700,
            cursor: saving ? "default" : "pointer",
            fontFamily: "inherit",
            flexShrink: 0,
          }}
        >
          <Icon name="plus" size={13} color={C.navy} />
          Nouveau projet
        </button>
      </div>
    </div>
    {showNew && <NewProjectModal onClose={() => setShowNew(false)} onCreate={createAndLink} />}
    </>
  );
}
