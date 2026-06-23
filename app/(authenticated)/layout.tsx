"use client";

import { useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SWRConfig } from "swr";
import { AppDataProvider, useAppData } from "@/components/AppDataProvider";
import { hasSeenOnboarding, OnboardingTour } from "@/components/OnboardingTour";
import { useEffect } from "react";
import { C } from "@/lib/design-tokens";
import { createClient } from "@/lib/supabase/client";
import { useIsMobile } from "@/lib/use-responsive";
import { Icon } from "@/components/Icon";
import { LinkSessionModal } from "@/components/LinkSessionModal";
import { Sidebar, SidebarView } from "@/components/Sidebar";

function pathToView(pathname: string): SidebarView {
  if (pathname.startsWith("/library")) return "library";
  if (pathname.startsWith("/tasks")) return "tasks";
  if (pathname.startsWith("/agenda")) return "agenda";
  if (pathname.startsWith("/projects")) return "projects";
  return "chat";
}

function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const supabase = createClient();
  const {
    sessions,
    archivedSessions,
    projectsById,
    taskOpenCount,
    userEmail,
    archiveSession,
    restoreSession,
    deleteSession,
    linkingSessionId,
    setLinkingSessionId,
    loadSessions,
    loadArchivedSessions,
    loadProjects,
  } = useAppData();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    if (!hasSeenOnboarding()) setShowOnboarding(true);
  }, []);

  const activeSessionId = pathname.startsWith("/chat/") ? pathname.split("/")[2] ?? null : null;
  const currentView = pathToView(pathname);

  const linkingSession =
    sessions.find((s) => s.id === linkingSessionId) ?? archivedSessions.find((s) => s.id === linkingSessionId) ?? null;

  return (
    <div style={{ display: "flex", width: "100vw", height: "100dvh", overflow: "hidden" }}>
      {isMobile && sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            zIndex: 98,
            animation: "fndFadeIn 0.15s ease",
          }}
        />
      )}
      <Sidebar
        sessions={sessions}
        archivedSessions={archivedSessions}
        projectsById={projectsById}
        activeSessionId={activeSessionId}
        currentView={currentView}
        taskOpenCount={taskOpenCount}
        onSelectSession={(id) => {
          router.push(`/chat/${id}`);
          setSidebarOpen(false);
        }}
        onNewSession={() => {
          // Passe par le sélecteur de projet (home) : on choisit le projet de
          // rattachement dès la création, ou « Continuer sans projet ».
          router.push("/home");
          setSidebarOpen(false);
        }}
        onOpenAccount={() => {
          router.push("/account");
          setSidebarOpen(false);
        }}
        onSignOut={async () => {
          await supabase.auth.signOut();
        }}
        onArchiveSession={archiveSession}
        onRestoreSession={restoreSession}
        onDeleteSession={deleteSession}
        onLinkSession={(id) => setLinkingSessionId(id)}
        userEmail={userEmail}
        isMobileOpen={sidebarOpen}
        onMobileClose={() => setSidebarOpen(false)}
      />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {isMobile && (
          <div
            style={{
              height: 52,
              background: C.white,
              borderBottom: `1px solid ${C.border}`,
              display: "flex",
              alignItems: "center",
              padding: "0 16px",
              flexShrink: 0,
              gap: 12,
              zIndex: 10,
            }}
          >
            <button
              onClick={() => setSidebarOpen(true)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 4,
                display: "flex",
                borderRadius: 6,
              }}
            >
              <Icon name="menu" size={22} color={C.text} />
            </button>
            <img src="/fondio.gif" alt="Fondio" style={{ height: 33, width: "auto" }} />
          </div>
        )}
        <div style={{ flex: 1, display: "flex", overflow: "hidden", animation: "fndFadeIn 0.18s ease" }}>
          {children}
        </div>
      </div>

      {linkingSessionId && (
        <LinkSessionModal
          sessionId={linkingSessionId}
          currentProjectId={linkingSession?.project_id ?? null}
          onClose={() => setLinkingSessionId(null)}
          onLinked={() => {
            loadSessions();
            loadArchivedSessions();
            loadProjects();
            setLinkingSessionId(null);
          }}
        />
      )}

      {showOnboarding && <OnboardingTour onDone={() => setShowOnboarding(false)} />}
    </div>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    // revalidateOnFocus désactivé : on garde le comportement actuel (pas de
    // refetch automatique au retour sur l'onglet). Le cache est rafraîchi par
    // les mutations optimistes et les `refresh()` explicites.
    <SWRConfig value={{ revalidateOnFocus: false, revalidateOnReconnect: false }}>
      <AppDataProvider>
        <AppShell>{children}</AppShell>
      </AppDataProvider>
    </SWRConfig>
  );
}
