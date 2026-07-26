import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Cible des liens email envoyés par Supabase (confirmation signup + reset password).
// Échange le `code` PKCE contre une session, puis renvoie sur la home.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  // `next` est contrôlé par l'attaquant (paramètre d'URL) : on n'accepte QUE des
  // chemins internes. Sans ça, `?next=https://evil.com` ferait une redirection
  // ouverte (phishing) juste après l'authentification.
  const next = safeNext(url.searchParams.get("next"));

  if (code) {
    const supabase = createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, url.origin));
    }
  }

  return NextResponse.redirect(new URL("/auth/auth-error", url.origin));
}

// N'autorise qu'un chemin relatif du même site : commence par un seul "/" (pas
// "//host" ni "/\host", qui seraient interprétés comme des URLs absolues).
function safeNext(next: string | null): string {
  if (next && /^\/[^/\\]/.test(next)) return next;
  return "/home";
}
