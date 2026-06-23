/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Tree-shaking ciblé des gros barrels : react-icons réexporte des milliers
  // d'icônes, on ne bundle que celles réellement importées dans Icon.tsx.
  experimental: {
    optimizePackageImports: ["react-icons"],
  },
};

export default nextConfig;
