import { NextResponse } from "next/server";
import { loadUserByokConfig, type SupabaseLike } from "@/lib/byok";
import { callChatModel, describeLLMError } from "@/lib/llm";
import { parseAgentReply } from "@/lib/parse-agent-reply";
import {
  buildProjectSummaryPrompt,
  SUMMARY_MAX_LENGTH,
  SUMMARY_MIN_INTERVAL_MS,
} from "@/lib/project-summary";
import {
  parseProjectSummary,
  type Project,
  type ProjectSessionRow,
  type ProjectSummary,
} from "@/lib/projects";
import { createClient } from "@/lib/supabase/server";
import type { Task } from "@/lib/data";

export const runtime = "nodejs";

interface SummaryRequest {
  projectId?: string;
}

export async function POST(req: Request) {
  let body: SummaryRequest;
  try {
    body = (await req.json()) as SummaryRequest;
  } catch {
    return NextResponse.json({ error: "Corps de requête invalide." }, { status: 400 });
  }

  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  if (!projectId) {
    return NextResponse.json({ error: "projectId requis." }, { status: 400 });
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  // Le serveur recharge lui-même l'état du projet : rien de ce que le client
  // envoie n'entre dans le prompt, il pourrait mentir sur son avancement.
  const { data: project } = await supabase
    .from("projects")
    .select("id, name, stage, glossary, summary")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .single();
  if (!project) {
    return NextResponse.json({ error: "Projet introuvable." }, { status: 404 });
  }

  // Limitation de débit déduite de la dernière génération — déjà chargée pour la
  // suite, donc gratuite, persistante et valable quel que soit le nombre
  // d'instances. Un échec LLM n'écrit rien : re-tenter reste possible aussitôt.
  const previous = parseProjectSummary((project as { summary?: unknown }).summary);
  if (previous && Date.now() - Date.parse(previous.generated_at) < SUMMARY_MIN_INTERVAL_MS) {
    return NextResponse.json(
      { error: "Vous venez de faire le point. Réessayez dans une minute." },
      { status: 429 },
    );
  }

  const [{ data: taskRows }, { data: sessionRows }] = await Promise.all([
    supabase.from("tasks").select("*").eq("project_id", projectId).eq("user_id", user.id),
    supabase
      .from("sessions")
      .select("id, agent_id, title, challenger_mode, messages, updated_at, panel_agent_ids")
      .eq("project_id", projectId)
      .eq("user_id", user.id)
      .is("archived_at", null),
  ]);

  const messages = buildProjectSummaryPrompt({
    project: project as unknown as Project,
    tasks: (taskRows ?? []) as Task[],
    sessions: (sessionRows ?? []) as ProjectSessionRow[],
  });

  const byok = await loadUserByokConfig(supabase as unknown as SupabaseLike, user.id);

  let result: Awaited<ReturnType<typeof callChatModel>>;
  try {
    result = await callChatModel(messages, { byok });
  } catch (e: unknown) {
    return NextResponse.json({ error: describeLLMError(e) }, { status: 503 });
  }

  // Filet : la consigne interdit les sections, mais un petit modèle local en
  // produit parfois quand même. On ne garde que la prose.
  const text = parseAgentReply(result.data).content.trim().slice(0, SUMMARY_MAX_LENGTH);
  if (!text) {
    return NextResponse.json({ error: "Réponse vide du modèle." }, { status: 503 });
  }

  const summary: ProjectSummary = {
    text,
    provider: result.provider,
    providerLabel: result.providerLabel,
    generated_at: new Date().toISOString(),
  };

  await supabase.from("projects").update({ summary }).eq("id", projectId).eq("user_id", user.id);

  return NextResponse.json(summary);
}
