/** @type {import('next').NextConfig} */

// En-têtes de sécurité appliqués à toutes les réponses. On reste volontairement
// conservateur sur la Content-Security-Policy : l'app utilise des styles inline
// (design-tokens) et du markdown rendu en HTML, donc on N'AJOUTE PAS de
// script-src/style-src restrictifs (qui casseraient l'hydratation Next et les
// styles). On verrouille en revanche ce qui est gratuit et à forte valeur :
// impossible d'embarquer le site dans une iframe (clickjacking), de détourner
// <base> ou les cibles de formulaire.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  },
];

const nextConfig = {
  reactStrictMode: true,
  // Tree-shaking ciblé des gros barrels : react-icons réexporte des milliers
  // d'icônes, on ne bundle que celles réellement importées dans Icon.tsx.
  experimental: {
    optimizePackageImports: ["react-icons"],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
