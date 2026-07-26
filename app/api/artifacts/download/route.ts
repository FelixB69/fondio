import { NextResponse } from "next/server";
import { utils as xlsxUtils, write as xlsxWrite } from "xlsx";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import PDFDocument from "pdfkit";
import type { Artifact } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Garde-fous anti-abus : la génération PDF/xlsx/docx est coûteuse en CPU. On
// borne la taille de l'artefact reçu pour qu'une requête ne puisse pas saturer
// le serveur (des milliers de lignes ou un markdown géant).
const MAX_ROWS = 5000;
const MAX_COLS = 100;
const MAX_MARKDOWN_LENGTH = 500_000;

type TableFormat = "csv" | "xlsx" | "json";
type DocFormat = "md" | "txt" | "pdf" | "docx";
type Format = TableFormat | DocFormat;

const TABLE_FORMATS: TableFormat[] = ["csv", "xlsx", "json"];
const DOC_FORMATS: DocFormat[] = ["md", "txt", "pdf", "docx"];

interface DownloadRequest {
  artifact: Artifact;
  format: Format;
}

const MIME: Record<Format, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  json: "application/json",
  md: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export async function POST(req: Request) {
  // Endpoint réservé aux utilisateurs authentifiés : la conversion de documents
  // est une opération serveur coûteuse, on ne l'expose pas au tout-venant.
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  let body: DownloadRequest;
  try {
    body = (await req.json()) as DownloadRequest;
  } catch {
    return NextResponse.json({ error: "JSON invalide." }, { status: 400 });
  }

  const { artifact, format } = body;
  if (!artifact || !format) {
    return NextResponse.json({ error: "artifact et format requis." }, { status: 400 });
  }

  const sizeError = validateArtifactSize(artifact);
  if (sizeError) {
    return NextResponse.json({ error: sizeError }, { status: 400 });
  }

  const isTable = artifact.kind === "table";
  const allowed = isTable ? TABLE_FORMATS : DOC_FORMATS;
  if (!(allowed as string[]).includes(format)) {
    return NextResponse.json(
      { error: `Format "${format}" indisponible pour ce livrable.` },
      { status: 400 },
    );
  }

  const filename = `${slugify(artifact.title)}.${format}`;

  let buffer: Buffer;
  try {
    buffer = await render(artifact, format);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Conversion impossible.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": MIME[format],
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(buffer.length),
    },
  });
}

// Rejette les artefacts hors bornes AVANT tout rendu (voir les constantes en
// tête de fichier). Renvoie un message d'erreur, ou null si tout est bon.
function validateArtifactSize(artifact: Artifact): string | null {
  if (artifact.kind === "table") {
    if (!Array.isArray(artifact.headers) || !Array.isArray(artifact.rows)) {
      return "Tableau invalide.";
    }
    if (artifact.headers.length > MAX_COLS) {
      return `Trop de colonnes (max ${MAX_COLS}).`;
    }
    if (artifact.rows.length > MAX_ROWS) {
      return `Trop de lignes (max ${MAX_ROWS}).`;
    }
  } else if (artifact.kind === "document") {
    if (typeof artifact.markdown !== "string") {
      return "Document invalide.";
    }
    if (artifact.markdown.length > MAX_MARKDOWN_LENGTH) {
      return "Document trop volumineux.";
    }
  }
  return null;
}

async function render(artifact: Artifact, format: Format): Promise<Buffer> {
  if (artifact.kind === "table") {
    switch (format as TableFormat) {
      case "csv":
        return Buffer.from(toCsv(artifact.headers, artifact.rows), "utf8");
      case "xlsx":
        return toXlsx(artifact.title, artifact.headers, artifact.rows);
      case "json":
        return Buffer.from(JSON.stringify(tableToObjects(artifact.headers, artifact.rows), null, 2), "utf8");
    }
  }

  // document
  switch (format as DocFormat) {
    case "md":
      return Buffer.from(`# ${artifact.title}\n\n${artifact.markdown}`, "utf8");
    case "txt":
      return Buffer.from(`${artifact.title}\n\n${stripMarkdown(artifact.markdown)}`, "utf8");
    case "pdf":
      return mdToPdf(artifact.title, artifact.markdown);
    case "docx":
      return mdToDocx(artifact.title, artifact.markdown);
  }

  throw new Error("Format non supporté.");
}

// ---------- Tableaux ----------

function escapeCsvCell(cell: string): string {
  if (/[",\n\r]/.test(cell)) return `"${cell.replace(/"/g, '""')}"`;
  return cell;
}

function toCsv(headers: string[], rows: string[][]): string {
  const all = [headers, ...rows];
  return all.map((r) => r.map(escapeCsvCell).join(",")).join("\r\n");
}

function toXlsx(title: string, headers: string[], rows: string[][]): Buffer {
  const ws = xlsxUtils.aoa_to_sheet([headers, ...rows]);
  const wb = xlsxUtils.book_new();
  xlsxUtils.book_append_sheet(wb, ws, title.slice(0, 31) || "Sheet1");
  const out = xlsxWrite(wb, { type: "buffer", bookType: "xlsx" });
  return Buffer.isBuffer(out) ? out : Buffer.from(out);
}

function tableToObjects(headers: string[], rows: string[][]): Record<string, string>[] {
  return rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
}

// ---------- Documents ----------

// Conversion markdown → texte brut (pour PDF/TXT). Ne couvre pas tout markdown,
// juste headings, gras, italique, listes — suffisant pour les sorties LLM.
function stripMarkdown(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/^\s*\d+\.\s+/gm, (m) => m);
}

function mdToPdf(title: string, markdown: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      doc.fontSize(20).text(title, { underline: false });
      doc.moveDown();

      const lines = markdown.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          doc.moveDown(0.5);
          continue;
        }
        const h = trimmed.match(/^(#{1,6})\s+(.*)$/);
        if (h) {
          const level = h[1].length;
          const size = Math.max(11, 18 - level * 2);
          doc.fontSize(size).text(stripMarkdown(h[2]));
          doc.moveDown(0.3);
          continue;
        }
        if (/^\s*[-*]\s+/.test(line)) {
          doc.fontSize(11).text("• " + stripMarkdown(line.replace(/^\s*[-*]\s+/, "")), {
            indent: 12,
          });
          continue;
        }
        doc.fontSize(11).text(stripMarkdown(line));
      }

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

async function mdToDocx(title: string, markdown: string): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun(title)],
    }),
  ];

  for (const line of markdown.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      children.push(new Paragraph({ children: [new TextRun("")] }));
      continue;
    }
    const h = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const heading =
        level === 1
          ? HeadingLevel.HEADING_1
          : level === 2
            ? HeadingLevel.HEADING_2
            : level === 3
              ? HeadingLevel.HEADING_3
              : HeadingLevel.HEADING_4;
      children.push(new Paragraph({ heading, children: [new TextRun(stripMarkdown(h[2]))] }));
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          children: [new TextRun(stripMarkdown(line.replace(/^\s*[-*]\s+/, "")))],
        }),
      );
      continue;
    }
    children.push(new Paragraph({ children: [new TextRun(stripMarkdown(line))] }));
  }

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}

function slugify(s: string): string {
  return (
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "livrable"
  );
}
