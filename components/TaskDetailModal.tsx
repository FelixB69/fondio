"use client";

// Popup d'édition d'une tâche planifiée, ouverte au clic sur une barre de la
// timeline de l'agenda. Permet de modifier le contenu, le statut, la priorité,
// les dates (début + échéance), d'ouvrir la session source et de supprimer.
import { useEffect, useState, type CSSProperties } from "react";
import { AGENTS, AgentId, Task, TaskPriority, TaskStatus } from "@/lib/data";
import { C } from "@/lib/design-tokens";
import { dueDateMeta, sortedComments, STATUS_META, STATUS_ORDER } from "@/lib/tasks";
import type { ProjectLite } from "./AgendaTimeline";
import { Badge } from "./TaskBits";
import { Icon, IconName } from "./Icon";

interface TaskDetailModalProps {
  task: Task;
  project?: ProjectLite;
  onClose: () => void;
  onSetStatus: (status: TaskStatus) => void;
  onSetPriority: (p: TaskPriority) => void;
  onSetStart: (d: string | null) => void;
  onSetDue: (d: string | null) => void;
  onSetContent: (c: string) => void;
  onDelete: () => void;
  onOpenSession: (id: string) => void;
  onAddComment: (content: string) => void;
  onEditComment: (commentId: string, content: string) => void;
  onDeleteComment: (commentId: string) => void;
}

export function TaskDetailModal({
  task,
  project,
  onClose,
  onSetStatus,
  onSetPriority,
  onSetStart,
  onSetDue,
  onSetContent,
  onDelete,
  onOpenSession,
  onAddComment,
  onEditComment,
  onDeleteComment,
}: TaskDetailModalProps) {
  const [draft, setDraft] = useState(task.content);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  // Échap ferme la popup (cohérent avec les autres modaux).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const commitContent = () => {
    const text = draft.trim();
    if (text && text !== task.content) onSetContent(text);
    else setDraft(task.content);
  };

  const submitNewComment = () => {
    const text = newComment.trim();
    if (!text) return;
    onAddComment(text);
    setNewComment("");
  };

  const commitEdit = (commentId: string) => {
    const text = editDraft.trim();
    if (text) onEditComment(commentId, text);
    setEditingCommentId(null);
  };

  const commentDateLabel = (iso: string) =>
    new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  const agent = task.source_agent_id ? AGENTS[task.source_agent_id as AgentId] : null;
  const due = task.due_date ? dueDateMeta(task.due_date, task.status === "done") : null;
  const projColor = project?.color ?? C.navy;

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
    maxHeight: "85vh",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 16,
    boxShadow: C.shadowMd,
  };

  const labelStyle: CSSProperties = {
    fontSize: 10,
    fontWeight: 800,
    color: C.textMute,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    marginBottom: 6,
  };

  const dateInputStyle: CSSProperties = {
    background: C.white,
    border: `1.5px solid ${C.border}`,
    borderRadius: 8,
    padding: "7px 10px",
    fontSize: 12.5,
    fontWeight: 600,
    fontFamily: "inherit",
    width: "100%",
    boxSizing: "border-box",
    cursor: "pointer",
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        {/* En-tête */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: C.text, letterSpacing: "-0.02em" }}>
            Modifier la tâche
          </h2>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: C.textMute, display: "flex", flexShrink: 0 }}
          >
            <Icon name="close" size={16} color={C.textMute} />
          </button>
        </div>

        {/* Contenu éditable */}
        <div>
          <div style={labelStyle}>Tâche</div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitContent}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                (e.target as HTMLTextAreaElement).blur();
              }
            }}
            rows={2}
            style={{
              width: "100%",
              boxSizing: "border-box",
              fontSize: 14,
              color: C.text,
              lineHeight: 1.45,
              fontFamily: "inherit",
              border: `1.5px solid ${C.border}`,
              borderRadius: 8,
              padding: "8px 10px",
              outline: "none",
              resize: "vertical",
              background: C.white,
            }}
          />
        </div>

        {/* Statut — contrôle segmenté */}
        <div>
          <div style={labelStyle}>Statut</div>
          <div style={{ display: "flex", gap: 6 }}>
            {STATUS_ORDER.map((s) => {
              const meta = STATUS_META[s];
              const active = task.status === s;
              return (
                <button
                  key={s}
                  onClick={() => onSetStatus(s)}
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 5,
                    background: active ? meta.bg : C.white,
                    color: active ? meta.color : C.textSub,
                    border: `1.5px solid ${active ? meta.color : C.border}`,
                    borderRadius: 8,
                    padding: "7px 8px",
                    fontSize: 12.5,
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {s === "done" && <Icon name="check" size={12} color={active ? meta.color : C.textSub} />}
                  {meta.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Dates */}
        <div style={{ display: "flex", gap: 12 }}>
          <label style={{ flex: 1 }}>
            <div style={labelStyle}>Début</div>
            <input
              type="date"
              value={task.start_date ?? ""}
              max={task.due_date ?? undefined}
              onChange={(e) => onSetStart(e.target.value || null)}
              style={{ ...dateInputStyle, color: task.start_date ? C.text : C.textMute }}
            />
          </label>
          <label style={{ flex: 1 }}>
            <div style={labelStyle}>Échéance</div>
            <input
              type="date"
              value={task.due_date ?? ""}
              min={task.start_date ?? undefined}
              onChange={(e) => onSetDue(e.target.value || null)}
              style={{ ...dateInputStyle, color: task.due_date ? C.text : C.textMute }}
            />
          </label>
        </div>

        {/* Priorité */}
        <div>
          <div style={labelStyle}>Priorité</div>
          <select
            value={task.priority}
            onChange={(e) => onSetPriority(e.target.value as TaskPriority)}
            style={{ ...dateInputStyle, cursor: "pointer" }}
          >
            <option value="low">Basse</option>
            <option value="normal">Normale</option>
            <option value="high">Haute</option>
          </select>
        </div>

        {/* Métadonnées : projet, échéance relative, session source */}
        {(project || due || (agent && task.session_id)) && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {project && (
              <Badge label={project.name} color={projColor} bg={`${projColor}14`} icon={(project.icon ?? "target") as IconName} />
            )}
            {due && <Badge label={due.label} color={due.color} bg={due.bg} icon="clock" />}
            {agent && task.session_id && (
              <button
                onClick={() => onOpenSession(task.session_id!)}
                title={`Ouvrir la session · ${agent.name}`}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: agent.color, display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, fontFamily: "inherit" }}
              >
                <Icon name={agent.icon as IconName} size={11} color={agent.color} />
                {agent.name}
                <Icon name="externalLink" size={10} color={agent.color} />
              </button>
            )}
          </div>
        )}

        {/* Commentaires */}
        <div>
          <div style={labelStyle}>Commentaires</div>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submitNewComment();
                }
              }}
              placeholder="Ajouter un commentaire…"
              rows={1}
              style={{
                flex: 1,
                boxSizing: "border-box",
                fontSize: 13,
                color: C.text,
                fontFamily: "inherit",
                border: `1.5px solid ${C.border}`,
                borderRadius: 8,
                padding: "7px 10px",
                outline: "none",
                resize: "none",
                background: C.white,
              }}
            />
            <button
              onClick={submitNewComment}
              disabled={!newComment.trim()}
              style={{
                background: newComment.trim() ? C.navy : C.bg,
                color: newComment.trim() ? "white" : C.textMute,
                border: "none",
                borderRadius: 8,
                padding: "0 14px",
                fontSize: 12.5,
                fontWeight: 700,
                cursor: newComment.trim() ? "pointer" : "default",
                fontFamily: "inherit",
              }}
            >
              Ajouter
            </button>
          </div>

          {sortedComments(task).length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {sortedComments(task).map((c) => (
                <div
                  key={c.id}
                  style={{
                    border: `1.5px solid ${C.border}`,
                    borderRadius: 8,
                    padding: "8px 10px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  {editingCommentId === c.id ? (
                    <textarea
                      autoFocus
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onBlur={() => commitEdit(c.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          (e.target as HTMLTextAreaElement).blur();
                        }
                      }}
                      rows={2}
                      style={{
                        width: "100%",
                        boxSizing: "border-box",
                        fontSize: 13,
                        color: C.text,
                        fontFamily: "inherit",
                        border: "none",
                        outline: "none",
                        resize: "vertical",
                        padding: 0,
                      }}
                    />
                  ) : (
                    <div style={{ fontSize: 13, color: C.text, lineHeight: 1.4, whiteSpace: "pre-wrap" }}>
                      {c.content}
                    </div>
                  )}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 10.5, color: C.textMute, fontWeight: 600 }}>
                      {commentDateLabel(c.updated_at ?? c.created_at)}
                      {c.updated_at && " · modifié"}
                    </span>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={() => {
                          setEditingCommentId(c.id);
                          setEditDraft(c.content);
                        }}
                        style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex" }}
                      >
                        <Icon name="pencil" size={12} color={C.textMute} />
                      </button>
                      <button
                        onClick={() => onDeleteComment(c.id)}
                        style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex" }}
                      >
                        <Icon name="trash" size={12} color={C.textMute} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pied : suppression (gauche) + fermeture (droite) */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 2 }}>
          {confirmDelete ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: C.textSub }}>Supprimer ?</span>
              <button
                onClick={onDelete}
                style={{ background: "#DC2626", color: "white", border: "none", borderRadius: 7, padding: "6px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
              >
                Confirmer
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                style={{ background: "none", border: "none", color: C.textSub, fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
              >
                Annuler
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#DC2626", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", padding: 0 }}
            >
              <Icon name="trash" size={13} color="#DC2626" />
              Supprimer
            </button>
          )}
          <button
            onClick={onClose}
            style={{ background: C.navy, color: "white", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
          >
            Terminé
          </button>
        </div>
      </div>
    </div>
  );
}
