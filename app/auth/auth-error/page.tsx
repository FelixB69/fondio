import Link from "next/link";

export default function AuthErrorPage() {
  return (
    <div
      style={{
        width: "100vw",
        height: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#F6F8FC",
        fontFamily: "DM Sans, -apple-system, sans-serif",
        padding: 24,
      }}
    >
      <div
        style={{
          background: "white",
          padding: "32px 36px",
          borderRadius: 14,
          maxWidth: 420,
          textAlign: "center",
          border: "1px solid #E8ECF1",
          boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            background: "#FEF0F4",
            border: "1.5px solid #E8396A40",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 18px",
            fontSize: 26,
          }}
        >
          ⚠️
        </div>
        <h1
          style={{
            margin: "0 0 8px",
            fontSize: 20,
            fontWeight: 800,
            color: "#1A2438",
            letterSpacing: "-0.02em",
          }}
        >
          Lien invalide ou expiré
        </h1>
        <p style={{ margin: "0 0 24px", fontSize: 14, color: "#64748B", lineHeight: 1.6 }}>
          Le lien d'authentification est expiré ou a déjà été utilisé. Réessaye depuis l'écran de
          connexion.
        </p>
        <Link
          href="/"
          style={{
            display: "inline-block",
            background: "#264573",
            color: "white",
            padding: "11px 22px",
            borderRadius: 9,
            fontSize: 14,
            fontWeight: 700,
            textDecoration: "none",
          }}
        >
          Retour à la connexion
        </Link>
      </div>
    </div>
  );
}
