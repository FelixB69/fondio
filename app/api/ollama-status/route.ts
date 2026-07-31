import { NextResponse } from "next/server";
import { BYOK_CHAT_MODELS, MODELS, byokDisplayLabel, type BYOKProviderId } from "@/lib/llm";
import { createClient } from "@/lib/supabase/server";
import type { ModelStatus } from "@/lib/models";
import { OLLAMA_AUTH_ERROR, isLocalOllama, ollamaFetch } from "@/lib/ollama";

export const runtime = "nodejs";

// Un serveur distant paie la latence réseau (DNS + TLS + proxy) : 2 s suffisent
// en local mais font passer un serveur sain pour indisponible à l'autre bout.
const PROBE_TIMEOUT_MS = isLocalOllama() ? 2000 : 5000;

// Renvoie l'état d'Ollama, la config réelle des modèles, ET (si l'utilisateur
// est authentifié) son statut BYOK — pour que ModelSelector affiche le bon
// fournisseur sans appel séparé.
export async function GET() {
  let available = false;
  try {
    const res = await ollamaFetch("/api/tags", {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    available = res.ok;
  } catch (e) {
    available = false;
    // Serveur éteint = cas normal, on reste silencieux. Identifiants refusés =
    // erreur de configuration : on la trace, sinon elle est indiscernable d'un
    // serveur arrêté côté UI.
    if (e instanceof Error && e.message.startsWith(OLLAMA_AUTH_ERROR)) {
      console.warn("[ollama-status]", e.message);
    }
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
