import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "Fondio : agents IA conseillers pour vos projets perso et pro",
  description:
    "Fondio réunit des agents IA spécialisés (stratégie, finance, tech, marketing, coaching) pour vous accompagner sur vos projets personnels et professionnels, avec des livrables concrets à chaque session.",
  openGraph: {
    title: "Fondio : agents IA conseillers pour vos projets perso et pro",
    description:
      "Des agents IA spécialisés en stratégie, finance, tech, marketing et coaching pour avancer concrètement sur vos projets.",
    locale: "fr_FR",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;0,9..40,800;1,9..40,400&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
