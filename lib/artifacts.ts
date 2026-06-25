// Génération des artefacts structurés (tables / documents) à partir des
// livrables annoncés par un agent. Source de vérité unique, partagée par les
// routes /api/chat et /api/panel-chat (avant : code dupliqué à l'identique).
import { ARTIFACTS_FORMAT_PROMPT, type Artifact, type ChatMessage } from "./data";
import { callChatModel, type BYOKConfig } from "./llm";

export async function generateArtifacts(args: {
  conversation: ChatMessage[];
  assistantReply: string;
  deliverableTitles: string[];
  forceProvider?: "local" | "cloud";
  byok?: BYOKConfig | null;
}): Promise<Artifact[]> {
  const { conversation, assistantReply, deliverableTitles, forceProvider, byok } = args;

  // On ne renvoie que les ~6 derniers tours pour limiter le contexte.
  const recent = conversation.slice(-6);
  const transcript = recent
    .map((m) => `${m.role === "user" ? "Utilisateur" : "Assistant"} : ${m.content}`)
    .join("\n\n");

  const userPrompt = `Conversation récente :

${transcript}

Dernière réponse de l'assistant :

${assistantReply}

L'assistant a annoncé ces livrables :
${deliverableTitles.map((t) => `- ${t}`).join("\n")}

Produis le contenu complet de chaque livrable au format JSON décrit.`;

  try {
    const { data: raw } = await callChatModel(
      [
        { role: "system", content: ARTIFACTS_FORMAT_PROMPT },
        { role: "user", content: userPrompt },
      ],
      { jsonMode: true, useArtifactModel: true, forceProvider, byok },
    );
    const parsed = JSON.parse(raw) as { artifacts?: unknown };
    if (!Array.isArray(parsed.artifacts)) return [];

    return parsed.artifacts.flatMap((a): Artifact[] => {
      if (!a || typeof a !== "object") return [];
      const obj = a as Record<string, unknown>;
      const title = typeof obj.title === "string" && obj.title.trim() ? obj.title.trim() : "Livrable";

      if (obj.kind === "table") {
        const headers = Array.isArray(obj.headers) ? obj.headers.map((h) => String(h ?? "")) : [];
        const rows = Array.isArray(obj.rows)
          ? obj.rows.filter((r): r is unknown[] => Array.isArray(r)).map((r) => r.map((c) => String(c ?? "")))
          : [];
        if (!headers.length || !rows.length) return [];
        // Normalise la longueur des lignes pour matcher headers.
        const normalized = rows.map((r) => {
          if (r.length === headers.length) return r;
          if (r.length < headers.length) return [...r, ...Array(headers.length - r.length).fill("")];
          return r.slice(0, headers.length);
        });
        return [{ kind: "table", title, headers, rows: normalized }];
      }

      if (obj.kind === "document") {
        const markdown = typeof obj.markdown === "string" ? obj.markdown.trim() : "";
        if (!markdown) return [];
        return [{ kind: "document", title, markdown }];
      }

      return [];
    });
  } catch {
    return [];
  }
}
