import { NextResponse } from "next/server";
import { BYOK_CHAT_MODELS, MODELS, byokDisplayLabel, type BYOKProviderId } from "@/lib/llm";
import { createClient } from "@/lib/supabase/server";
import type { ModelStatus } from "@/lib/models";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";

export const runtime = "nodejs";

// Renvoie l'état d'Ollama, la config réelle des modèles, ET (si l'utilisateur
// est authentifié) son statut BYOK — pour que ModelSelector affiche le bon
// fournisseur sans appel séparé.
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

  let byok: ModelStatus["byok"] = null;
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("preferred_ai_provider")
      .eq("user_id", user.id)
      .single();
    const provider = profile?.preferred_ai_provider as BYOKProviderId | null;
    if (provider) {
      const { data: keyRow } = await supabase
        .from("user_api_keys")
        .select("id")
        .eq("user_id", user.id)
        .eq("provider", provider)
        .single();
      byok = {
        configured: Boolean(keyRow),
        provider,
        label: byokDisplayLabel(provider),
        chatModel: BYOK_CHAT_MODELS[provider],
      };
    }
  }

  const body: ModelStatus = {
    available,
    local: MODELS.local,
    cloud: MODELS.cloud,
    byok,
  };
  return NextResponse.json(body);
}
