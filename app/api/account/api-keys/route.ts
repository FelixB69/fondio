import { NextResponse } from "next/server";
import { BYOK_PROVIDER_IDS } from "@/lib/byok";
import { encryptSecret } from "@/lib/crypto";
import { testByokKey, type BYOKProviderId } from "@/lib/llm";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function isValidProvider(p: unknown): p is BYOKProviderId {
  return typeof p === "string" && (BYOK_PROVIDER_IDS as string[]).includes(p);
}

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const body = (await req.json()) as { provider?: unknown; apiKey?: unknown };
  if (!isValidProvider(body.provider) || typeof body.apiKey !== "string" || !body.apiKey.trim()) {
    return NextResponse.json({ error: "provider et apiKey requis." }, { status: 400 });
  }

  const test = await testByokKey(body.provider, body.apiKey.trim());
  if (!test.ok) {
    return NextResponse.json({ error: `Clé invalide : ${test.error}` }, { status: 400 });
  }

  const encrypted_key = encryptSecret(body.apiKey.trim());
  const { error } = await supabase
    .from("user_api_keys")
    .upsert(
      { user_id: user.id, provider: body.provider, encrypted_key, updated_at: new Date().toISOString() },
      { onConflict: "user_id,provider" },
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const body = (await req.json()) as { provider?: unknown };
  if (!isValidProvider(body.provider)) {
    return NextResponse.json({ error: "provider requis." }, { status: 400 });
  }

  const { error } = await supabase
    .from("user_api_keys")
    .delete()
    .eq("user_id", user.id)
    .eq("provider", body.provider);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Si c'était le fournisseur préféré, on retombe sur Local/Mistral Fondio.
  const { data: profile } = await supabase
    .from("profiles")
    .select("preferred_ai_provider")
    .eq("user_id", user.id)
    .single();
  if (profile?.preferred_ai_provider === body.provider) {
    await supabase.from("profiles").update({ preferred_ai_provider: null }).eq("user_id", user.id);
  }

  return NextResponse.json({ ok: true });
}

export async function PUT(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const body = (await req.json()) as { preferredProvider?: unknown };
  const preferredProvider = body.preferredProvider;
  if (preferredProvider !== null && !isValidProvider(preferredProvider)) {
    return NextResponse.json({ error: "preferredProvider invalide." }, { status: 400 });
  }

  if (preferredProvider !== null) {
    const { data: keyRow } = await supabase
      .from("user_api_keys")
      .select("id")
      .eq("user_id", user.id)
      .eq("provider", preferredProvider)
      .single();
    if (!keyRow) {
      return NextResponse.json(
        { error: "Aucune clé enregistrée pour ce fournisseur : ajoutez-la d'abord." },
        { status: 400 },
      );
    }
  }

  const { error } = await supabase
    .from("profiles")
    .update({ preferred_ai_provider: preferredProvider })
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
