"use client";

// Rendu d'un artefact (tableau, document ou maquette) + téléchargement et
// conversion en tâche. Composant PARTAGÉ par le chat simple et le panel (avant :
// dupliqué à l'identique dans les deux). Le bouton « Tâche » n'apparaît que si
// `onConvertToTask` est fourni.
//
// Les maquettes suivent un chemin à part (PrototypeBlock) : elles ne se
// téléchargent pas via /api/artifacts/download (qui produit du xlsx/pdf/docx),
// et s'affichent dans une iframe sandboxée plutôt qu'en HTML inline.

import { useEffect, useMemo, useState } from "react";
import { markdownToSafeHtml } from "@/lib/markdown";
import type { Artifact } from "@/lib/data";
import { C } from "@/lib/design-tokens";
import { PROTOTYPE_SANDBOX, buildPrototypeSrcDoc } from "@/lib/prototype";
import { useIsMobile } from "@/lib/use-responsive";
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

// Bouton « Tâche » — partagé par les trois types d'artefact.
function TaskButton({
  title,
  color,
  tasked,
  onConvertToTask,
}: {
  title: string;
  color: string;
  tasked: boolean;
  onConvertToTask: (text: string) => void;
}) {
  return (
    <button
      onClick={() => !tasked && onConvertToTask(title)}
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
  );
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
  if (artifact.kind === "prototype") {
    return (
      <PrototypeBlock
        artifact={artifact}
        color={color}
        bg={bg}
        onConvertToTask={onConvertToTask}
        tasked={tasked}
      />
    );
  }
  return (
    <StaticArtifactBlock
      artifact={artifact}
      color={color}
      bg={bg}
      onConvertToTask={onConvertToTask}
      tasked={tasked}
    />
  );
}

function StaticArtifactBlock({
  artifact,
  color,
  bg,
  onConvertToTask,
  tasked = false,
}: {
  artifact: Extract<Artifact, { kind: "table" | "document" }>;
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
          <TaskButton
            title={artifact.title}
            color={color}
            tasked={tasked}
            onConvertToTask={onConvertToTask}
          />
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

// Largeur du cadre en mode « Mobile » — celle d'un grand téléphone courant.
const MOBILE_PREVIEW_WIDTH = 390;
const INLINE_PREVIEW_HEIGHT = 440;

function toolbarButtonStyle(active: boolean, color: string) {
  return {
    background: active ? color : C.white,
    color: active ? C.white : color,
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
    whiteSpace: "nowrap" as const,
  };
}

// Maquette cliquable. Le HTML tourne dans une iframe à origine opaque
// (cf. lib/prototype.ts) : ni lecture du DOM parent, ni accès à la session
// Supabase, ni appel réseau sortant. Aucune édition ici — pour modifier, on
// redemande au Maquettiste en français.
//
// Le plein écran ne monte PAS un second iframe : c'est le même arbre React qui
// change de style. Sinon, agrandir rechargerait la page et effacerait ce que la
// personne venait d'y cliquer.
function PrototypeBlock({
  artifact,
  color,
  bg,
  onConvertToTask,
  tasked = false,
}: {
  artifact: Extract<Artifact, { kind: "prototype" }>;
  color: string;
  bg: string;
  onConvertToTask?: (text: string) => void;
  tasked?: boolean;
}) {
  const [tab, setTab] = useState<"preview" | "code">("preview");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [fullscreen, setFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const isMobile = useIsMobile();

  const srcDoc = useMemo(() => buildPrototypeSrcDoc(artifact.html), [artifact.html]);

  // Échap ferme le plein écran, et on bloque le scroll de la page derrière.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [fullscreen]);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(artifact.html);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      role={fullscreen ? "dialog" : undefined}
      aria-modal={fullscreen ? true : undefined}
      aria-label={fullscreen ? artifact.title : undefined}
      style={
        fullscreen
          ? {
              position: "fixed",
              inset: 0,
              zIndex: 1000,
              background: "rgba(15,23,42,0.88)",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              padding: isMobile ? 12 : 24,
            }
          : {
              marginTop: 12,
              background: bg,
              border: `1px solid ${color}28`,
              borderRadius: 8,
              padding: "10px 12px",
              animation: "fndFadeIn 0.3s ease both",
            }
      }
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {!fullscreen && <Icon name="code" size={11} color={color} />}
        <div
          style={{
            flex: 1,
            minWidth: 110,
            fontSize: fullscreen ? 13 : 11.5,
            fontWeight: fullscreen ? 700 : 800,
            color: fullscreen ? C.white : color,
            letterSpacing: fullscreen ? undefined : "0.04em",
            textTransform: fullscreen ? undefined : "uppercase",
          }}
        >
          {artifact.title}
        </div>

        {onConvertToTask && !fullscreen && (
          <TaskButton
            title={artifact.title}
            color={color}
            tasked={tasked}
            onConvertToTask={onConvertToTask}
          />
        )}

        <button onClick={() => setTab("preview")} style={toolbarButtonStyle(tab === "preview", color)}>
          Aperçu
        </button>
        <button onClick={() => setTab("code")} style={toolbarButtonStyle(tab === "code", color)}>
          Code
        </button>

        {tab === "preview" && !isMobile && (
          <button
            onClick={() => setDevice((d) => (d === "desktop" ? "mobile" : "desktop"))}
            title="Basculer entre rendu ordinateur et rendu téléphone"
            style={toolbarButtonStyle(device === "mobile", color)}
          >
            <Icon name="laptop" size={9} color={device === "mobile" ? C.white : color} />
            {device === "mobile" ? "Mobile" : "Desktop"}
          </button>
        )}

        {tab === "code" && (
          <button onClick={copyCode} style={toolbarButtonStyle(false, color)}>
            <Icon name={copied ? "check" : "copy"} size={9} color={color} />
            {copied ? "Copié" : "Copier"}
          </button>
        )}

        <button
          onClick={() => setFullscreen((v) => !v)}
          title={fullscreen ? "Fermer (Échap)" : "Afficher en plein écran"}
          style={toolbarButtonStyle(false, color)}
        >
          <Icon name={fullscreen ? "close" : "externalLink"} size={9} color={color} />
          {fullscreen ? "Fermer" : "Agrandir"}
        </button>
      </div>

      {/* Un seul conteneur pour les deux onglets : l'iframe reste montée quand
          on passe sur « Code », donc revenir à l'aperçu ne relance pas la
          maquette. On la masque au lieu de la démonter. */}
      <div
        style={{
          flex: fullscreen ? 1 : undefined,
          minHeight: 0,
          height: fullscreen ? undefined : INLINE_PREVIEW_HEIGHT,
          position: "relative",
        }}
      >
        <div
          style={{
            display: tab === "preview" ? "flex" : "none",
            justifyContent: "center",
            height: "100%",
            background: C.white,
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            overflow: "hidden",
          }}
        >
          <iframe
            title={artifact.title}
            srcDoc={srcDoc}
            // Origine opaque : `allow-scripts` SANS `allow-same-origin`.
            // Ajouter ce dernier annulerait entièrement le bac à sable.
            sandbox={PROTOTYPE_SANDBOX}
            referrerPolicy="no-referrer"
            style={{
              border: "none",
              height: "100%",
              width: device === "mobile" && !isMobile ? MOBILE_PREVIEW_WIDTH : "100%",
              maxWidth: "100%",
              background: C.white,
            }}
          />
        </div>
        <pre
          style={{
            display: tab === "code" ? "block" : "none",
            margin: 0,
            height: "100%",
            boxSizing: "border-box",
            background: "#0F172A",
            color: "#E2E8F0",
            borderRadius: 6,
            padding: "12px 14px",
            fontSize: 11.5,
            lineHeight: 1.55,
            overflow: "auto",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          }}
        >
          <code>{artifact.html}</code>
        </pre>
      </div>

      {/* Garantie côté UI, indépendante de ce que le modèle a bien voulu écrire
          dans sa réponse : la maquette ne persiste rien. */}
      {!fullscreen && (
        <div style={{ marginTop: 8, fontSize: 11, color: C.textSub, lineHeight: 1.45 }}>
          Maquette de démonstration : les données affichées sont fictives et disparaissent si vous
          rechargez. Pour la modifier, demandez-le simplement dans le chat.
        </div>
      )}
    </div>
  );
}

function ArtifactMarkdown({ markdown }: { markdown: string }) {
  const html = markdownToSafeHtml(markdown);
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
