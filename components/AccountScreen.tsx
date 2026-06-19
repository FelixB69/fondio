"use client";

import { useCallback, useEffect, useState } from "react";
import { LuLoader } from "react-icons/lu";
import { C } from "@/lib/design-tokens";
import { createClient } from "@/lib/supabase/client";
import { useIsMobile } from "@/lib/use-responsive";
import { Icon } from "./Icon";

function Field({
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  disabled,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const isMobile = useIsMobile();
  return (
    <div style={{ marginBottom: 18 }}>
      <label style={{ display: "block", fontSize: 13.5, fontWeight: 600, color: C.text, marginBottom: 7 }}>{label}</label>
      <input
        type={type}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          width: "100%",
          padding: isMobile ? "11px 14px" : "14px 16px",
          border: `1.5px solid ${focused ? C.navy : C.border}`,
          borderRadius: 9,
          fontSize: isMobile ? 14 : 15.5,
          color: C.text,
          background: disabled ? C.bg : C.white,
          outline: "none",
          boxSizing: "border-box",
          fontFamily: "inherit",
          transition: "border-color 0.15s",
        }}
      />
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: C.white,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        padding: 22,
        height: "100%",
        boxSizing: "border-box",
      }}
    >
      <h3 style={{ margin: "0 0 18px", fontSize: 15, fontWeight: 800, color: C.text, letterSpacing: "-0.01em" }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

function SubSection({ children, last }: { children: React.ReactNode; last?: boolean }) {
  return (
    <div
      style={{
        marginBottom: last ? 0 : 22,
        paddingBottom: last ? 0 : 22,
        borderBottom: last ? "none" : `1px solid ${C.border}`,
      }}
    >
      {children}
    </div>
  );
}

const primaryBtn = (loading: boolean): React.CSSProperties => ({
  padding: "10px 18px",
  background: C.navy,
  color: "white",
  border: "none",
  borderRadius: 9,
  fontSize: 13.5,
  fontWeight: 700,
  cursor: loading ? "default" : "pointer",
  fontFamily: "inherit",
  opacity: loading ? 0.7 : 1,
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
});

export function AccountScreen({ onBack }: { onBack: () => void }) {
  const isMobile = useIsMobile();
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [loadingProfile, setLoadingProfile] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const [profileMsg, setProfileMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [emailMsg, setEmailMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [passwordMsg, setPasswordMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoadingProfile(false);
        return;
      }
      setEmail(user.email ?? "");
      const { data: profile } = await supabase.from("profiles").select("full_name").eq("user_id", user.id).single();
      setFullName(profile?.full_name ?? "");
      setLoadingProfile(false);
    })();
  }, [supabase]);

  const saveProfile = useCallback(async () => {
    setSavingProfile(true);
    setProfileMsg(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { error } = await supabase
        .from("profiles")
        .update({ full_name: fullName.trim() })
        .eq("user_id", user.id);
      setProfileMsg(error ? { type: "err", text: error.message } : { type: "ok", text: "Profil mis à jour." });
    } finally {
      setSavingProfile(false);
    }
  }, [supabase, fullName]);

  const saveEmail = useCallback(async () => {
    setSavingEmail(true);
    setEmailMsg(null);
    try {
      if (!email.includes("@")) {
        setEmailMsg({ type: "err", text: "Adresse e-mail invalide." });
        return;
      }
      const { error } = await supabase.auth.updateUser({ email });
      setEmailMsg(
        error
          ? { type: "err", text: error.message }
          : { type: "ok", text: "Un e-mail de confirmation a été envoyé à la nouvelle adresse." },
      );
    } finally {
      setSavingEmail(false);
    }
  }, [supabase, email]);

  const savePassword = useCallback(async () => {
    setPasswordMsg(null);
    if (newPassword.length < 6) {
      setPasswordMsg({ type: "err", text: "Minimum 6 caractères." });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMsg({ type: "err", text: "Les mots de passe ne correspondent pas." });
      return;
    }
    setSavingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        setPasswordMsg({ type: "err", text: error.message });
      } else {
        setPasswordMsg({ type: "ok", text: "Mot de passe mis à jour." });
        setNewPassword("");
        setConfirmPassword("");
      }
    } finally {
      setSavingPassword(false);
    }
  }, [supabase, newPassword, confirmPassword]);

  const Msg = ({ msg }: { msg: { type: "ok" | "err"; text: string } | null }) => {
    if (!msg) return null;
    return (
      <div style={{ fontSize: 12.5, color: msg.type === "ok" ? C.mint : C.pink, marginTop: 10 }}>{msg.text}</div>
    );
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: C.bg }}>
      <div
        style={{
          background: C.white,
          borderBottom: `1px solid ${C.border}`,
          padding: isMobile ? "10px 12px" : "12px 20px",
          display: "flex",
          alignItems: "center",
          gap: isMobile ? 8 : 12,
          flexShrink: 0,
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 6,
            borderRadius: 6,
            display: "flex",
            color: C.textSub,
          }}
          title="Retour"
        >
          <Icon name="arrowLeft" size={16} color={C.textSub} />
        </button>
        <div style={{ fontSize: isMobile ? 13 : 14.5, fontWeight: 800, color: C.text, letterSpacing: "-0.02em" }}>
          Mon compte
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: isMobile ? 16 : "28px 32px" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto", height: "100%" }}>
          {loadingProfile ? (
            <div style={{ color: C.textSub, fontSize: 13 }}>Chargement…</div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
                gap: 20,
                alignItems: "start",
              }}
            >
              <SectionCard title="Profil">
                <SubSection>
                  <Field label="Nom complet" value={fullName} onChange={setFullName} placeholder="Marie Lambert" />
                  <button onClick={saveProfile} disabled={savingProfile} style={primaryBtn(savingProfile)}>
                    {savingProfile && <LuLoader size={14} style={{ animation: "fndSpin 0.7s linear infinite" }} />}
                    Enregistrer
                  </button>
                  <Msg msg={profileMsg} />
                </SubSection>
                <SubSection last>
                  <Field label="Adresse e-mail" type="email" value={email} onChange={setEmail} />
                  <button onClick={saveEmail} disabled={savingEmail} style={primaryBtn(savingEmail)}>
                    {savingEmail && <LuLoader size={14} style={{ animation: "fndSpin 0.7s linear infinite" }} />}
                    Mettre à jour l'e-mail
                  </button>
                  <Msg msg={emailMsg} />
                </SubSection>
              </SectionCard>

              <SectionCard title="Mot de passe">
                <Field
                  label="Nouveau mot de passe"
                  type="password"
                  value={newPassword}
                  onChange={setNewPassword}
                  placeholder="Minimum 6 caractères"
                />
                <Field
                  label="Confirmer le mot de passe"
                  type="password"
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  placeholder="••••••••"
                />
                <button onClick={savePassword} disabled={savingPassword} style={primaryBtn(savingPassword)}>
                  {savingPassword && <LuLoader size={14} style={{ animation: "fndSpin 0.7s linear infinite" }} />}
                  Changer le mot de passe
                </button>
                <Msg msg={passwordMsg} />
              </SectionCard>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
