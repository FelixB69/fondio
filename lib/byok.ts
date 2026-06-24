// Charge la préférence BYOK de l'utilisateur (profiles.preferred_ai_provider)
// et la clé correspondante (user_api_keys), déchiffrée. Centralise cette
// lecture pour que app/api/chat, lib/web-search et lib/artifacts l'utilisent
// tous de la même façon.
import { decryptSecret } from "./crypto";
import type { BYOKConfig, BYOKProviderId } from "./llm";

export const BYOK_PROVIDER_IDS: BYOKProviderId[] = ["anthropic", "openai", "google", "mistral_byok"];

// Sous-ensemble minimal de l'API Supabase utilisé ici — permet de mocker
// facilement dans les tests sans dépendre du vrai client typé.
export interface SupabaseLike {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        eq?(column: string, value: string): { single(): Promise<{ data: unknown }> };
        single(): Promise<{ data: unknown }>;
      };
    };
  };
}

export async function loadUserByokConfig(
  supabase: SupabaseLike,
  userId: string,
): Promise<BYOKConfig | null> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("preferred_ai_provider")
    .eq("user_id", userId)
    .single();

  const provider = (profile as { preferred_ai_provider?: BYOKProviderId | null } | null)
    ?.preferred_ai_provider;
  if (!provider) return null;

  const keyQuery = supabase.from("user_api_keys").select("encrypted_key").eq("user_id", userId);
  const { data: row } = await (keyQuery.eq?.("provider", provider) ?? keyQuery).single();

  const encryptedKey = (row as { encrypted_key?: string } | null)?.encrypted_key;
  if (!encryptedKey) return null;

  try {
    return { provider, apiKey: decryptSecret(encryptedKey) };
  } catch {
    return null;
  }
}
