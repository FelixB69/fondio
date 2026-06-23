"use client";

import { useState, type CSSProperties } from "react";
import Image from "next/image";
import { LuLoader, LuArrowLeft, LuCheck } from "react-icons/lu";
import { FcGoogle } from "react-icons/fc";
import { FaLinkedin } from "react-icons/fa";
import { AGENTS, AgentId } from "@/lib/data";
import { Icon, IconName } from "./Icon";
import { C } from "@/lib/design-tokens";
import { createClient } from "@/lib/supabase/client";
import { useIsMobile } from "@/lib/use-responsive";

function AuthBrand() {
  const featuredIds: AgentId[] = ["strategist", "analyst", "finance", "coach", "mentor"];
  return (
    <div
      style={{
        width: 420,
        flexShrink: 0,
        background: `linear-gradient(160deg, #1a3260 0%, ${C.navy} 50%, #1e4d7a 100%)`,
        display: "flex",
        flexDirection: "column",
        padding: "36px 40px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: -80,
          right: -80,
          width: 280,
          height: 280,
          borderRadius: "50%",
          background: `${C.mint}18`,
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: -60,
          left: -60,
          width: 220,
          height: 220,
          borderRadius: "50%",
          background: `${C.pink}14`,
        }}
      />

      <div style={{ marginBottom: 28, position: "relative" }}>
        <Image src="/fondio-logo.png" alt="Fondio" width={790} height={272} priority style={{ height: 68, width: "auto", display: "block" }} />
      </div>

      <div style={{ position: "relative", marginBottom: 22 }}>
        <h2
          style={{
            margin: "0 0 10px",
            fontSize: 22,
            fontWeight: 800,
            color: "white",
            letterSpacing: "-0.03em",
            lineHeight: 1.25,
          }}
        >
          Vos conseillers IA spécialisés,{" "}
          <br />
          en local (100% confidentiel).
        </h2>
        <p style={{ margin: 0, fontSize: 13, color: "rgba(255,255,255,0.6)", lineHeight: 1.6 }}>
          Stratégie, finance, lancement, projets du quotidien. Sessions structurées avec livrables et mode challenger. Tourne sur Mistral & Qwen2.5-Coder, tout en restant sur nos serveurs.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 7, position: "relative" }}>
        {featuredIds.map((id, i) => {
          const agent = AGENTS[id];
          return (
            <div
              key={id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                background: "rgba(255,255,255,0.07)",
                borderRadius: 9,
                padding: "8px 12px",
                border: "1px solid rgba(255,255,255,0.10)",
                backdropFilter: "blur(4px)",
                transform: `translateX(${i % 2 === 0 ? 0 : 10}px)`,
              }}
            >
              <div
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 7,
                  background: agent.bg,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Icon name={agent.icon as IconName} size={13} color={agent.color} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.92)" }}>{agent.name}</div>
                <div
                  style={{
                    fontSize: 10.5,
                    color: "rgba(255,255,255,0.45)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {agent.desc}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: "auto", paddingTop: 20, fontSize: 11, color: "rgba(255,255,255,0.4)", position: "relative" }}>
        100 % local · aucune donnée envoyée à un service externe.
      </div>
    </div>
  );
}

function InputField({
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  error,
  autoFocus,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string;
  autoFocus?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 6 }}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          width: "100%",
          padding: "11px 14px",
          border: `1.5px solid ${error ? C.pink : focused ? C.navy : C.border}`,
          borderRadius: 9,
          fontSize: 14,
          color: C.text,
          background: C.bg,
          outline: "none",
          boxSizing: "border-box",
          fontFamily: "inherit",
          transition: "border-color 0.15s",
        }}
      />
      {error && <div style={{ fontSize: 12, color: C.pink, marginTop: 4 }}>{error}</div>}
    </div>
  );
}

type AuthView = "login" | "signup" | "forgot" | "confirm";

function mapAuthError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("invalid login")) return "E-mail ou mot de passe incorrect";
  if (m.includes("already registered") || m.includes("user already")) return "Cet e-mail est déjà utilisé";
  return msg;
}

export function AuthScreen({
  onAuthenticated,
  initialView = "login",
  onBack,
}: {
  onAuthenticated: () => void;
  initialView?: "login" | "signup";
  onBack?: () => void;
}) {
  const [view, setView] = useState<AuthView>(initialView);
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const set = (k: keyof typeof form) => (v: string) => setForm((p) => ({ ...p, [k]: v }));

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.email.includes("@")) e.email = "Adresse e-mail invalide";
    if (form.password.length < 6) e.password = "Minimum 6 caractères";
    if (view === "signup" && !form.firstName.trim()) e.firstName = "Champ requis";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const supabase = createClient();

  const handleOAuth = async (provider: "google" | "linkedin_oidc") => {
    setLoading(true);
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${origin}/auth/callback` },
    });
    // Le navigateur est redirigé vers le provider ; setLoading(false) jamais atteint en cas de succès.
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      if (view === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email: form.email,
          password: form.password,
        });
        if (error) {
          setErrors({ password: mapAuthError(error.message) });
          return;
        }
        onAuthenticated();
      } else if (view === "signup") {
        const fullName = `${form.firstName.trim()} ${form.lastName.trim()}`.trim();
        const origin = typeof window !== "undefined" ? window.location.origin : "";
        const { data, error } = await supabase.auth.signUp({
          email: form.email,
          password: form.password,
          options: {
            data: { full_name: fullName },
            emailRedirectTo: `${origin}/auth/callback`,
          },
        });
        if (error) {
          setErrors({ email: mapAuthError(error.message) });
          return;
        }
        // Confirmation email obligatoire : on n'autorise jamais l'accès tant
        // que l'utilisateur n'a pas cliqué sur le lien (et atterri sur /auth/callback).
        if (!data.session) {
          setView("confirm");
          return;
        }
        onAuthenticated();
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async () => {
    if (!form.email.includes("@")) {
      setErrors({ email: "Adresse e-mail invalide" });
      return;
    }
    setLoading(true);
    try {
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      await supabase.auth.resetPasswordForEmail(form.email, {
        redirectTo: `${origin}/auth/callback`,
      });
      setView("confirm");
    } finally {
      setLoading(false);
    }
  };

  const oauthBtn: CSSProperties = {
    width: "100%",
    padding: "10px",
    background: C.white,
    color: C.text,
    border: `1.5px solid ${C.border}`,
    borderRadius: 9,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  };

  const renderOAuthButtons = () => (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <button type="button" onClick={() => handleOAuth("google")} disabled={loading} style={{ ...oauthBtn, opacity: loading ? 0.7 : 1 }}>
          <FcGoogle size={18} /> Continuer avec Google
        </button>
        <button type="button" onClick={() => handleOAuth("linkedin_oidc")} disabled={loading} style={{ ...oauthBtn, opacity: loading ? 0.7 : 1 }}>
          <FaLinkedin size={18} color="#0A66C2" /> Continuer avec LinkedIn
        </button>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "20px 0" }}>
        <div style={{ flex: 1, height: 1, background: C.border }} />
        <span style={{ fontSize: 12, color: C.textSub, fontWeight: 600 }}>OU</span>
        <div style={{ flex: 1, height: 1, background: C.border }} />
      </div>
    </div>
  );

  const primaryBtn: CSSProperties = {
    width: "100%",
    padding: "12px",
    background: C.navy,
    color: "white",
    border: "none",
    borderRadius: 9,
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "opacity 0.15s",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  };

  const renderLogin = () => (
    <div>
      <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 800, color: C.text, letterSpacing: "-0.03em" }}>
        Connexion
      </h2>
      <p style={{ margin: "0 0 28px", color: C.textSub, fontSize: 14 }}>
        Pas encore de compte ?{" "}
        <button
          onClick={() => setView("signup")}
          style={{
            background: "none",
            border: "none",
            color: C.navy,
            fontWeight: 700,
            cursor: "pointer",
            fontSize: 14,
            fontFamily: "inherit",
            padding: 0,
          }}
        >
          Créer un compte
        </button>
      </p>

      {renderOAuthButtons()}

      <InputField
        label="Adresse e-mail"
        type="email"
        value={form.email}
        onChange={set("email")}
        placeholder="vous@exemple.com"
        error={errors.email}
        autoFocus
      />
      <InputField
        label="Mot de passe"
        type="password"
        value={form.password}
        onChange={set("password")}
        placeholder="••••••••"
        error={errors.password}
      />

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <button
          onClick={() => setView("forgot")}
          style={{
            background: "none",
            border: "none",
            color: C.navy,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Mot de passe oublié ?
        </button>
      </div>

      <button onClick={handleSubmit} disabled={loading} style={{ ...primaryBtn, opacity: loading ? 0.7 : 1 }}>
        {loading ? (
          <>
            <LuLoader size={16} style={{ animation: "fndSpin 0.7s linear infinite" }} /> Connexion…
          </>
        ) : (
          "Se connecter →"
        )}
      </button>
    </div>
  );

  const renderSignup = () => (
    <div>
      <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 800, color: C.text, letterSpacing: "-0.03em" }}>
        Créer un compte
      </h2>
      <p style={{ margin: "0 0 24px", color: C.textSub, fontSize: 14 }}>
        Déjà inscrit ?{" "}
        <button
          onClick={() => setView("login")}
          style={{
            background: "none",
            border: "none",
            color: C.navy,
            fontWeight: 700,
            cursor: "pointer",
            fontSize: 14,
            fontFamily: "inherit",
            padding: 0,
          }}
        >
          Se connecter
        </button>
      </p>

      {renderOAuthButtons()}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <InputField
          label="Prénom"
          value={form.firstName}
          onChange={set("firstName")}
          placeholder="Marie"
          error={errors.firstName}
          autoFocus
        />
        <InputField label="Nom" value={form.lastName} onChange={set("lastName")} placeholder="Lambert" />
      </div>
      <InputField
        label="Adresse e-mail"
        type="email"
        value={form.email}
        onChange={set("email")}
        placeholder="vous@exemple.com"
        error={errors.email}
      />
      <InputField
        label="Mot de passe"
        type="password"
        value={form.password}
        onChange={set("password")}
        placeholder="Minimum 6 caractères"
        error={errors.password}
      />

      <button onClick={handleSubmit} disabled={loading} style={{ ...primaryBtn, marginTop: 4, opacity: loading ? 0.7 : 1 }}>
        {loading ? (
          <>
            <LuLoader size={16} style={{ animation: "fndSpin 0.7s linear infinite" }} /> Création…
          </>
        ) : (
          "Créer mon compte →"
        )}
      </button>
    </div>
  );

  const renderForgot = () => (
    <div>
      <button
        onClick={() => setView("login")}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 6,
          color: C.textSub,
          fontSize: 13,
          marginBottom: 24,
          fontFamily: "inherit",
        }}
      >
        <LuArrowLeft size={14} color={C.textSub} /> Retour
      </button>
      <h2 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 800, color: C.text, letterSpacing: "-0.03em" }}>
        Mot de passe oublié
      </h2>
      <p style={{ margin: "0 0 24px", color: C.textSub, fontSize: 14, lineHeight: 1.6 }}>
        Veuillez saisir votre adresse e-mail, nous vous enverrons un lien de réinitialisation.
      </p>
      <InputField
        label="Adresse e-mail"
        type="email"
        value={form.email}
        onChange={set("email")}
        placeholder="vous@exemple.com"
        autoFocus
      />
      <button onClick={handleForgot} disabled={loading} style={{ ...primaryBtn, opacity: loading ? 0.7 : 1 }}>
        {loading ? (
          <>
            <LuLoader size={16} style={{ animation: "fndSpin 0.7s linear infinite" }} /> Envoi…
          </>
        ) : (
          "Envoyer le lien →"
        )}
      </button>
    </div>
  );

  const renderConfirm = () => (
    <div style={{ textAlign: "center", padding: "20px 0" }}>
      <div
        style={{
          width: 60,
          height: 60,
          borderRadius: 18,
          background: C.mintLight,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto 20px",
          border: `1.5px solid ${C.mint}50`,
        }}
      >
        <LuCheck size={28} color={C.mint} />
      </div>
      <h2 style={{ margin: "0 0 10px", fontSize: 22, fontWeight: 800, color: C.text, letterSpacing: "-0.03em" }}>
        E-mail envoyé !
      </h2>
      <p style={{ margin: "0 0 28px", color: C.textSub, fontSize: 14, lineHeight: 1.65 }}>
        Veuillez vérifier votre boîte mail et cliquer sur le lien pour finaliser votre inscription.
      </p>
      <button
        onClick={() => setView("login")}
        style={{
          background: "none",
          border: `1.5px solid ${C.border}`,
          borderRadius: 9,
          padding: "10px 24px",
          color: C.text,
          fontSize: 14,
          fontWeight: 600,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        Retour à la connexion
      </button>
    </div>
  );

  const content: Record<AuthView, () => JSX.Element> = {
    login: renderLogin,
    signup: renderSignup,
    forgot: renderForgot,
    confirm: renderConfirm,
  };

  const isMobile = useIsMobile();
  const showBrand = !isMobile && (view === "login" || view === "signup");

  if (isMobile) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100vw",
          height: "100dvh",
          background: `linear-gradient(160deg, #1a3260 0%, ${C.navy} 50%, #1e4d7a 100%)`,
          overflow: "hidden",
        }}
      >
        {/* Header bleu avec logo */}
        <div
          style={{
            padding: "52px 28px 28px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
            flexShrink: 0,
          }}
        >
          <Image src="/fondio-logo.png" alt="Fondio" width={790} height={272} priority style={{ height: 68, width: "auto", display: "block" }} />
          {(view === "login" || view === "signup") && (
            <p style={{ margin: 0, fontSize: 13, color: "rgba(255,255,255,0.55)", textAlign: "center", lineHeight: 1.5 }}>
              Vos conseillers IA spécialisés, en local.
            </p>
          )}
        </div>

        {/* Carte blanche avec le formulaire */}
        <div
          style={{
            flex: 1,
            background: C.white,
            borderRadius: "22px 22px 0 0",
            padding: "28px 24px 32px",
            overflowY: "auto",
            animation: "fndFadeIn 0.22s ease",
          }}
        >
          {onBack && (view === "login" || view === "signup") && (
            <button
              onClick={onBack}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
                color: C.textSub,
                fontSize: 13,
                marginBottom: 20,
                padding: 0,
                fontFamily: "inherit",
              }}
            >
              <LuArrowLeft size={14} color={C.textSub} /> Retour
            </button>
          )}
          {content[view]()}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", width: "100vw", height: "100dvh", overflow: "hidden", background: C.bg }}>
      {showBrand && <AuthBrand />}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 32,
          overflowY: "auto",
          background: C.white,
        }}
      >
        <div style={{ width: "100%", maxWidth: 420, animation: "fndFadeIn 0.22s ease" }}>
          {onBack && (view === "login" || view === "signup") && (
            <button
              onClick={onBack}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
                color: C.textSub,
                fontSize: 13,
                marginBottom: 20,
                padding: 0,
                fontFamily: "inherit",
              }}
            >
              <LuArrowLeft size={14} color={C.textSub} /> Retour
            </button>
          )}
          {content[view]()}
        </div>
      </div>
    </div>
  );
}
