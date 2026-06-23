"use client";

// Rendu d'un artefact (tableau ou document) + téléchargement + conversion en
// tâche. Composant PARTAGÉ par le chat simple et le panel (avant : dupliqué à
// l'identique dans les deux). Le bouton « Tâche » n'apparaît que si
// `onConvertToTask` est fourni.

import { useState } from "react";
import { marked } from "marked";
import type { Artifact } from "@/lib/data";
import { C } from "@/lib/design-tokens";
import { Icon } from "./Icon";

const TABLE_DOWNLOAD_FORMATS = [
  { format: "csv", label: "CSV" },
  { format: "xlsx", label: "Excel (.xlsx)" },
  { format: "json", label: "JSON" },
] as const;

const DOC_DOWNLOAD_FORMATS = [
  { format: "md", label: "Markdown (.md)" },
  { format: "pdf", label: "PDF" },
  { format: "docx", label: "Word (.docx)" },
  { format: "txt", label: "Texte (.txt)" },
] as const;

export async function downloadArtifact(artifact: Artifact, format: string): Promise<void> {
  const res = await fetch("/api/artifacts/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ artifact, format }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Téléchargement impossible." }));
    throw new Error(data.error ?? "Téléchargement impossible.");
  }
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match?.[1] ?? `livrable.${format}`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function ArtifactBlock({
  artifact,
  color,
  bg,
  onConvertToTask,
  tasked = false,
}: {
  artifact: Artifact;
  color: string;
  bg: string;
  onConvertToTask?: (text: string) => void;
  tasked?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const formats = artifact.kind === "table" ? TABLE_DOWNLOAD_FORMATS : DOC_DOWNLOAD_FORMATS;

  const handleDownload = async (format: string) => {
    setDownloading(format);
    setError(null);
    try {
      await downloadArtifact(artifact, format);
      setMenuOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Téléchargement impossible.");
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div
      style={{
        marginTop: 12,
        background: bg,
        border: `1px solid ${color}28`,
        borderRadius: 8,
        padding: "10px 12px",
        animation: "fndFadeIn 0.3s ease both",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Icon name={artifact.kind === "table" ? "chart" : "tasks"} size={11} color={color} />
        <div
          style={{
            flex: 1,
            fontSize: 11.5,
            fontWeight: 800,
            color,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          {artifact.title}
        </div>
        {onConvertToTask && (
          <button
            onClick={() => !tasked && onConvertToTask(artifact.title)}
            disabled={tasked}
            title={tasked ? "Déjà ajouté aux tâches" : "Convertir en tâche"}
            style={{
              background: tasked ? "transparent" : C.white,
              color: tasked ? "#0E9F88" : color,
              border: tasked ? "none" : `1px solid ${color}40`,
              borderRadius: 5,
              padding: tasked ? "2px 0" : "3px 8px",
              fontSize: 10.5,
              fontWeight: 700,
              cursor: tasked ? "default" : "pointer",
              fontFamily: "inherit",
              display: "flex",
              alignItems: "center",
              gap: 3,
            }}
          >
            {tasked ? (
              <>
                <Icon name="check" size={9} color="#0E9F88" /> Tâche
              </>
            ) : (
              <>
                <Icon name="plus" size={9} color={color} /> Tâche
              </>
            )}
          </button>
        )}
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            style={{
              background: C.white,
              color,
              border: `1px solid ${color}40`,
              borderRadius: 5,
              padding: "3px 8px",
              fontSize: 10.5,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
              display: "flex",
              alignItems: "center",
              gap: 3,
            }}
          >
            <Icon name="download" size={9} color={color} />
            Télécharger
          </button>
          {menuOpen && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                right: 0,
                background: C.white,
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                boxShadow: "0 6px 20px rgba(0,0,0,0.08)",
                padding: 4,
                zIndex: 10,
                minWidth: 160,
              }}
            >
              {formats.map((f) => (
                <button
                  key={f.format}
                  onClick={() => handleDownload(f.format)}
                  disabled={downloading !== null}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    background: "transparent",
                    border: "none",
                    padding: "7px 10px",
                    fontSize: 12.5,
                    color: C.text,
                    cursor: downloading !== null ? "wait" : "pointer",
                    fontFamily: "inherit",
                    borderRadius: 5,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = bg)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  {downloading === f.format ? "…" : f.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {artifact.kind === "table" ? (
        <ArtifactTable headers={artifact.headers} rows={artifact.rows} color={color} />
      ) : (
        <ArtifactMarkdown markdown={artifact.markdown} />
      )}

      {error && <div style={{ marginTop: 8, fontSize: 11.5, color: "#991B1B" }}>{error}</div>}
    </div>
  );
}

function ArtifactTable({
  headers,
  rows,
  color,
}: {
  headers: string[];
  rows: string[][];
  color: string;
}) {
  return (
    <div style={{ overflowX: "auto", background: C.white, borderRadius: 6 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, color: C.text }}>
        <thead>
          <tr style={{ background: `${color}12` }}>
            {headers.map((h, i) => (
              <th
                key={i}
                style={{
                  padding: "7px 10px",
                  textAlign: "left",
                  fontSize: 11.5,
                  fontWeight: 700,
                  color,
                  borderBottom: `1px solid ${color}28`,
                  whiteSpace: "nowrap",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
              {r.map((c, j) => (
                <td key={j} style={{ padding: "6px 10px", verticalAlign: "top", lineHeight: 1.5 }}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ArtifactMarkdown({ markdown }: { markdown: string }) {
  const html = marked.parse(markdown, { async: false }) as string;
  return (
    <div
      className="fnd-md"
      style={{
        background: C.white,
        borderRadius: 6,
        padding: "10px 14px",
        fontSize: 13,
        color: C.text,
        lineHeight: 1.6,
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
