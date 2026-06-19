"use client";

import { useCallback, useEffect, useState } from "react";
import { AgentId, ChatMessage, ProjectType } from "@/lib/data";
import { C } from "@/lib/design-tokens";
import { createClient } from "@/lib/supabase/client";
import { useIsMobile } from "@/lib/use-responsive";
import { AgentSelector } from "./AgentSelector";
import { AuthScreen } from "./AuthScreen";
import { ChatSession } from "./ChatSession";
import { Icon } from "./Icon";
import { LibraryScreen } from "./LibraryScreen";
import { LinkSessionModal } from "./LinkSessionModal";
import { MultiAgentSession } from "./MultiAgentSession";
import { AgendaScreen } from "./AgendaScreen";
import { ProjectDetailScreen } from "./ProjectDetailScreen";
import { ProjectPickerScreen } from "./ProjectPickerScreen";
import { ProjectsScreen } from "./ProjectsScreen";
import { Sidebar, SessionListItem, SidebarView } from "./Sidebar";
import { TasksScreen } from "./TasksScreen";
import { TypeSelector } from "./TypeSelector";

type Screen =
  | "auth"
  | "loading"
  | "project-picker"
  | "type"
  | "agents"
  | "chat"
  | "library"
  | "tasks"
  | "agenda"
  | "projects"
  | "project-detail";

interface SessionFull {
  id: string;
  project_type: ProjectType;
  project_id: string | null;
  agent_id: AgentId;
  title: string | null;
  challenger_mode: boolean;
  messages: ChatMessage[];
  updated_at: string;
  panel_agent_ids?: string[] | null;
}

export function App() {
  const supabase = createClient();
  const isMobile = useIsMobile();
  const [screen, setScreen] = useState<Screen>("loading");
  const [userEmail, setUserEmail] = useState<string | undefined>();
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [archivedSessions, setArchivedSessions] = useState<SessionListItem[]>([]);
  const [activeSession, setActiveSession] = useState<SessionFull | null>(null);
  const [pendingType, setPendingType] = useState<ProjectType | null>(null);
  const [pendingProjectId, setPendingProjectId] = useState<string | null>(null);
  const [agentsBackScreen, setAgentsBackScreen] = useState<Screen>("type");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [linkingSessionId, setLinkingSessionId] = useState<string | null>(null);
  const [taskOpenCount, setTaskOpenCount] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const loadSessions = useCallback(async () => {
    const { data } = await supabase
      .from("sessions")
      .select("id, agent_id, project_type, project_id, title, updated_at, panel_agent_ids")
      .is("archived_at", null)
      .order("updated_at", { ascending: false });
    setSessions((data ?? []) as SessionListItem[]);
  }, [supabase]);

  const loadArchivedSessions = useCallback(async () => {
    const { data } = await supabase
      .from("sessions")
      .select("id, agent_id, project_type, project_id, title, updated_at, panel_agent_ids")
      .not("archived_at", "is", null)
      .order("archived_at", { ascending: false });
    setArchivedSessions((data ?? []) as SessionListItem[]);
  }, [supabase]);

  const loadTaskCount = useCallback(async () => {
    const { count } = await supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .neq("status", "done");
    setTaskOpenCount(count ?? 0);
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!session) {
        setScreen("auth");
        return;
      }
      setUserEmail(session.user.email ?? undefined);
      await Promise.all([loadSessions(), loadArchivedSessions(), loadTaskCount()]);
      if (cancelled) return;
      setScreen("project-picker");
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      if (!session) {
        setScreen("auth");
        setSessions([]);
        setArchivedSessions([]);
        setActiveSession(null);
        setUserEmail(undefined);
        setTaskOpenCount(0);
      } else {
        setUserEmail(session.user.email ?? undefined);
      }
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [supabase, loadSessions, loadArchivedSessions, loadTaskCount]);

  // Recharge le compteur de tâches quand on passe sur l'écran tâches (les
  // mutations de status se font dans TasksScreen sans remonter ici).
  useEffect(() => {
    if (screen === "tasks") loadTaskCount();
  }, [screen, loadTaskCount]);

  const openSession = useCallback(
    async (id: string) => {
      const { data, error } = await supabase
        .from("sessions")
        .select("id, project_type, project_id, agent_id, title, challenger_mode, messages, updated_at, panel_agent_ids")
        .eq("id", id)
        .single();
      if (error || !data) return;
      setActiveSession({
        id: data.id,
        project_type: data.project_type,
        project_id: data.project_id ?? null,
        agent_id: data.agent_id,
        title: data.title,
        challenger_mode: data.challenger_mode,
        messages: Array.isArray(data.messages) ? (data.messages as ChatMessage[]) : [],
        updated_at: data.updated_at,
        panel_agent_ids: Array.isArray(data.panel_agent_ids) ? data.panel_agent_ids : null,
      });
      setScreen("chat");
    },
    [supabase],
  );

  const startNewSession = useCallback(
    async (agentIdOrIds: AgentId | AgentId[], type: ProjectType, projectId: string | null = null) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const isPanel = Array.isArray(agentIdOrIds);
      const primaryAgentId = isPanel ? agentIdOrIds[0] : agentIdOrIds;

      const { data, error } = await supabase
        .from("sessions")
        .insert({
          user_id: user.id,
          project_id: projectId,
          project_type: type,
          agent_id: primaryAgentId,
          challenger_mode: false,
          messages: [],
          panel_agent_ids: isPanel ? agentIdOrIds : null,
        })
        .select("id, project_type, project_id, agent_id, title, challenger_mode, messages, updated_at, panel_agent_ids")
        .single();
      if (error || !data) return;
      setPendingProjectId(null);

      setSessions((p) => [
        {
          id: data.id,
          agent_id: data.agent_id,
          project_type: data.project_type,
          project_id: data.project_id ?? null,
          title: data.title,
          updated_at: data.updated_at,
          panel_agent_ids: Array.isArray(data.panel_agent_ids) ? data.panel_agent_ids : null,
        },
        ...p,
      ]);
      setActiveSession({
        id: data.id,
        project_type: data.project_type,
        project_id: data.project_id ?? null,
        agent_id: data.agent_id,
        title: data.title,
        challenger_mode: data.challenger_mode,
        messages: [],
        updated_at: data.updated_at,
        panel_agent_ids: Array.isArray(data.panel_agent_ids) ? data.panel_agent_ids : null,
      });
      setScreen("chat");
    },
    [supabase],
  );

  const archiveSession = useCallback(
    async (id: string) => {
      const { error } = await supabase
        .from("sessions")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", id);
      if (error) return;
      const archived = sessions.find((s) => s.id === id);
      setSessions((p) => p.filter((s) => s.id !== id));
      if (archived) setArchivedSessions((p) => [archived, ...p]);
      if (activeSession?.id === id) {
        setActiveSession(null);
        setScreen("project-picker");
      }
    },
    [supabase, sessions, activeSession?.id],
  );

  const restoreSession = useCallback(
    async (id: string) => {
      const { error } = await supabase
        .from("sessions")
        .update({ archived_at: null })
        .eq("id", id);
      if (error) return;
      const restored = archivedSessions.find((s) => s.id === id);
      setArchivedSessions((p) => p.filter((s) => s.id !== id));
      if (restored) setSessions((p) => [restored, ...p]);
    },
    [supabase, archivedSessions],
  );

  const deleteSession = useCallback(
    async (id: string) => {
      const { error } = await supabase.from("sessions").delete().eq("id", id);
      if (error) return;
      setArchivedSessions((p) => p.filter((s) => s.id !== id));
    },
    [supabase],
  );

  const handleSignOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, [supabase]);

  const handleTitleChange = useCallback(
    (title: string) => {
      setActiveSession((s) => (s ? { ...s, title } : s));
      setSessions((list) =>
        list.map((s) => (s.id === activeSession?.id ? { ...s, title, updated_at: new Date().toISOString() } : s)),
      );
    },
    [activeSession?.id],
  );

  const navigate = useCallback((view: Exclude<SidebarView, "chat">) => {
    setScreen(view);
    setActiveSession(null);
    setPendingProjectId(null);
    setSelectedProjectId(null);
  }, []);

  if (screen === "loading") {
    return <div style={{ width: "100vw", height: "100dvh", background: "#F6F8FC" }} />;
  }

  if (screen === "auth") {
    return (
      <AuthScreen
        onAuthenticated={async () => {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          setUserEmail(session?.user.email ?? undefined);
          await Promise.all([loadSessions(), loadArchivedSessions(), loadTaskCount()]);
          setScreen("project-picker");
        }}
      />
    );
  }

  const sidebarView: SidebarView =
    screen === "library" ? "library"
    : screen === "tasks" ? "tasks"
    : screen === "agenda" ? "agenda"
    : screen === "projects" || screen === "project-detail" ? "projects"
    : "chat";

  const renderMain = () => {
    if (screen === "project-picker") {
      return (
        <ProjectPickerScreen
          onPickProject={(projectId, type) => {
            setAgentsBackScreen("project-picker");
            setPendingType(type);
            setPendingProjectId(projectId);
            setScreen("agents");
          }}
          onSkip={() => {
            setAgentsBackScreen("project-picker");
            setScreen("type");
          }}
        />
      );
    }
    if (screen === "type") {
      return (
        <TypeSelector
          onBack={agentsBackScreen === "project-picker" ? () => setScreen("project-picker") : undefined}
          onSelect={(t) => {
            setAgentsBackScreen("type");
            setPendingType(t);
            setScreen("agents");
          }}
        />
      );
    }
    if (screen === "agents" && pendingType) {
      return (
        <AgentSelector
          type={pendingType}
          onBack={() => setScreen(agentsBackScreen)}
          onSelect={(agentIdOrIds) => startNewSession(agentIdOrIds, pendingType, pendingProjectId)}
        />
      );
    }
    if (screen === "library") {
      return <LibraryScreen onOpenSession={openSession} />;
    }
    if (screen === "tasks") {
      return <TasksScreen onOpenSession={openSession} />;
    }
    if (screen === "agenda") {
      return <AgendaScreen onOpenSession={openSession} />;
    }
    if (screen === "projects") {
      return (
        <ProjectsScreen
          onOpenProject={(id) => {
            setSelectedProjectId(id);
            setScreen("project-detail");
          }}
          onStartSession={(projectId, type) => {
            setAgentsBackScreen("projects");
            setPendingType(type);
            setPendingProjectId(projectId);
            setScreen("agents");
          }}
          onOpenSession={openSession}
        />
      );
    }
    if (screen === "project-detail" && selectedProjectId) {
      return (
        <ProjectDetailScreen
          projectId={selectedProjectId}
          onBack={() => {
            setSelectedProjectId(null);
            setScreen("projects");
          }}
          onOpenSession={openSession}
          onStartSession={(projectId, type) => {
            setAgentsBackScreen("project-detail");
            setPendingType(type);
            setPendingProjectId(projectId);
            setScreen("agents");
          }}
        />
      );
    }
    if (screen === "chat" && activeSession) {
      const panelIds = activeSession.panel_agent_ids;
      if (panelIds && panelIds.length > 1) {
        return (
          <MultiAgentSession
            sessionId={activeSession.id}
            panelAgentIds={panelIds as AgentId[]}
            projectType={activeSession.project_type}
            initialMessages={activeSession.messages}
            onBack={() => setScreen("project-picker")}
            onTitleChange={handleTitleChange}
          />
        );
      }
      return (
        <ChatSession
          sessionId={activeSession.id}
          agentId={activeSession.agent_id}
          projectType={activeSession.project_type}
          projectId={activeSession.project_id}
          initialMessages={activeSession.messages}
          initialChallenger={activeSession.challenger_mode}
          onBack={() => setScreen("project-picker")}
          onTitleChange={handleTitleChange}
          onLinkProject={() => setLinkingSessionId(activeSession.id)}
        />
      );
    }
    return null;
  };

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
        activeSessionId={activeSession?.id ?? null}
        currentView={sidebarView}
        taskOpenCount={taskOpenCount}
        onSelectSession={(id) => { openSession(id); setSidebarOpen(false); }}
        onNewSession={() => {
          setActiveSession(null);
          setPendingType(null);
          setPendingProjectId(null);
          setAgentsBackScreen("type");
          setScreen("type");
          setSidebarOpen(false);
        }}
        onNavigate={(view) => { navigate(view); setSidebarOpen(false); }}
        onSignOut={handleSignOut}
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
          {renderMain()}
        </div>
      </div>

      {linkingSessionId && (
        <LinkSessionModal
          sessionId={linkingSessionId}
          currentProjectId={
            sessions.find((s) => s.id === linkingSessionId)?.project_id ??
            archivedSessions.find((s) => s.id === linkingSessionId)?.project_id ??
            null
          }
          onClose={() => setLinkingSessionId(null)}
          onLinked={(projectId) => {
            setSessions((p) => p.map((s) => (s.id === linkingSessionId ? { ...s, project_id: projectId } : s)));
            setArchivedSessions((p) => p.map((s) => (s.id === linkingSessionId ? { ...s, project_id: projectId } : s)));
            setActiveSession((s) => (s && s.id === linkingSessionId ? { ...s, project_id: projectId } : s));
            setLinkingSessionId(null);
          }}
        />
      )}
    </div>
  );
}
