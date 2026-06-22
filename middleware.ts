import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Rafraîchit le cookie de session Supabase à chaque requête (pattern recommandé
// par @supabase/ssr). Sans ça, les sessions expirent en silence côté client.
export async function middleware(req: NextRequest) {
  let response = NextResponse.next({ request: { headers: req.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value));
          response = NextResponse.next({ request: { headers: req.headers } });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = req.nextUrl;
  const isPublicPath = pathname === "/" || pathname === "/login" || pathname === "/signup";
  const isAuthOrApiRoute = pathname.startsWith("/auth") || pathname.startsWith("/api");

  if (!user && !isPublicPath && !isAuthOrApiRoute) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  if (user && isPublicPath) {
    return NextResponse.redirect(new URL("/home", req.url));
  }

  return response;
}

export const config = {
  matcher: [
    // Tout sauf les assets statiques et les fichiers Next internes.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
