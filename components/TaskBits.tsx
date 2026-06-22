"use client";

// Briques JSX partagées entre les écrans Tâches, Projet et Agenda.
import { useState } from "react";
import { Task, TaskPriority } from "@/lib/data";
import { C } from "@/lib/design-tokens";
import { Icon, IconName } from "./Icon";

// Petit badge générique réutilisé pour priorité + échéance.
export function Badge({ label, color, bg, icon }: { label: string; color: string; bg: string; icon?: IconName }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        background: bg,
        color,
        border: `1px solid ${color}28`,
        borderRadius: 5,
        padding: "2px 6px",
        fontSize: 10,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      {icon && <Icon name={icon} size={9} color={color} />}
      {label}
    </span>
  );
}

// Contrôles d'édition partagés (priorité + début + échéance).
export function TaskControls({
  task,
  onSetPriority,
  onSetStart,
  onSetDue,
}: {
  task: Task;
  onSetPriority: (p: TaskPriority) => void;
  onSetStart: (d: string | null) => void;
  onSetDue: (d: string | null) => void;
}) {
  const ctrlStyle = {
    background: C.white,
    color: C.textSub,
    border: `1px solid ${C.border}`,
    borderRadius: 6,
    padding: "3px 6px",
    fontSize: 11,
    fontWeight: 600,
    fontFamily: "inherit",
    cursor: "pointer",
  } as const;
  // Champ pleine largeur : combiné à la grille `auto 1fr`, tous les contrôles
  // s'alignent sur la même largeur (bords gauche + droite alignés).
  const fieldStyle = { ...ctrlStyle, width: "100%", boxSizing: "border-box" } as const;
  // Libellé de colonne. La colonne `auto` se cale sur le plus large (« Échéance »),
  // donc les trois libellés sont alignés sans largeur fixe à maintenir.
  const labelStyle = {
    fontSize: 10,
    fontWeight: 700,
    color: C.textMute,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    whiteSpace: "nowrap",
  } as const;
  return (
    // Grille 2 colonnes : libellés / contrôles. `display:contents` sur chaque
    // <label> fait participer ses 2 enfants directement à la grille parente, tout
    // en gardant le clic-sur-libellé qui focalise le champ.
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        columnGap: 8,
        rowGap: 5,
        alignItems: "center",
      }}
    >
      <label style={{ display: "contents" }}>
        <span style={labelStyle}>Priorité</span>
        <select
          value={task.priority}
          onChange={(e) => onSetPriority(e.target.value as TaskPriority)}
          style={fieldStyle}
        >
          <option value="low">Basse</option>
          <option value="normal">Normale</option>
          <option value="high">Haute</option>
        </select>
      </label>
      {/* Les inputs renvoient "" si vidés → on remet null. */}
      <label style={{ display: "contents" }}>
        <span style={labelStyle}>Début</span>
        <input
          type="date"
          value={task.start_date ?? ""}
          onChange={(e) => onSetStart(e.target.value || null)}
          style={{ ...fieldStyle, color: task.start_date ? C.text : C.textMute }}
        />
      </label>
      <label style={{ display: "contents" }}>
        <span style={labelStyle}>Échéance</span>
        <input
          type="date"
          value={task.due_date ?? ""}
          onChange={(e) => onSetDue(e.target.value || null)}
          style={{ ...fieldStyle, color: task.due_date ? C.text : C.textMute }}
        />
      </label>
    </div>
  );
}

// Contenu de tâche éditable au clic. État local (editing + draft) : tant qu'on
// n'édite pas, on affiche un div ; au clic on bascule en textarea. On sauvegarde
// sur Entrée ou perte de focus, on annule sur Échap. Le parent n'est notifié
// (onSave) que si le texte a réellement changé et n'est pas vide.
export function EditableContent({
  task,
  done,
  fontSize,
  onSave,
  singleLine = false,
}: {
  task: Task;
  done: boolean;
  fontSize: number;
  onSave: (content: string) => void;
  // singleLine : tronque sur une ligne avec « … » (ex. colonne étroite de la
  // timeline). Le texte complet reste accessible au survol (title).
  singleLine?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.content);

  const startEdit = () => {
    setDraft(task.content);
    setEditing(true);
  };
  const commit = () => {
    setEditing(false);
    const text = draft.trim();
    if (text && text !== task.content) onSave(text);
    else setDraft(task.content);
  };

  if (editing) {
    return (
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            setDraft(task.content);
            setEditing(false);
          }
        }}
        rows={2}
        style={{
          width: "100%",
          boxSizing: "border-box",
          fontSize,
          color: C.text,
          lineHeight: 1.45,
          fontFamily: "inherit",
          border: `1px solid ${C.navyMid}`,
          borderRadius: 6,
          padding: "5px 7px",
          outline: "none",
          resize: "vertical",
          background: C.white,
        }}
      />
    );
  }

  return (
    <div
      onClick={startEdit}
      title={singleLine ? task.content : "Cliquer pour modifier"}
      style={{
        fontSize,
        color: C.text,
        lineHeight: 1.45,
        textDecoration: done ? "line-through" : "none",
        opacity: done ? 0.7 : 1,
        cursor: "text",
        ...(singleLine
          ? { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }
          : { whiteSpace: "pre-wrap" }),
      }}
    >
      {task.content}
    </div>
  );
}

// Barre de chips de filtre, partagée Tâches/Projet.
export function FilterChips<T extends string>({
  filters,
  active,
  counts,
  onChange,
}: {
  filters: Array<{ id: T; label: string; icon?: IconName }>;
  active: T;
  counts: Record<T, number>;
  onChange: (f: T) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {filters.map((f) => {
        const isActive = active === f.id;
        const count = counts[f.id];
        // On masque les chips vides (sauf "all", toujours en première position).
        if (f.id !== filters[0].id && count === 0) return null;
        return (
          <button
            key={f.id}
            onClick={() => onChange(f.id)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              background: isActive ? C.navy : C.white,
              color: isActive ? "white" : C.textSub,
              border: `1.5px solid ${isActive ? C.navy : C.border}`,
              borderRadius: 100,
              padding: "5px 11px",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {f.icon && <Icon name={f.icon} size={11} color={isActive ? "white" : C.textSub} />}
            {f.label}
            <span style={{ opacity: isActive ? 0.85 : 0.6, fontWeight: 600 }}>{count}</span>
          </button>
        );
      })}
    </div>
  );
}
