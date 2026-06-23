import { NextResponse } from "next/server";
import { MODELS } from "@/lib/llm";
import type { ModelStatus } from "@/lib/models";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";

export const runtime = "nodejs";

// Renvoie l'état d'Ollama ET la config réelle des modèles, pour que l'UI affiche
// précisément « propulsé par <modèle> » au lieu de deviner / coder en dur.
export async function GET() {
  let available = false;
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    available = res.ok;
  } catch {
    available = false;
  }

  const body: ModelStatus = {
    available,
    local: MODELS.local,
    cloud: MODELS.cloud,
  };
  return NextResponse.json(body);
}
