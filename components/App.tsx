"use client";

import { useCallback, useEffect, useState } from "react";
import { AgentId, ChatMessage, ProjectType } from "@/lib/data";
import { createClient } from "@/lib/supabase/client";
import { AgentSelector } from "./AgentSelector";
import { AuthScreen } from "./AuthScreen";
import { ChatSession } from "./ChatSession";
import { LibraryScreen } from "./LibraryScreen";
import { Sidebar, SessionListItem, SidebarView } from "./Sidebar";
import { TasksScreen } from "./TasksScreen";
import { TypeSelector } from "./TypeSelector";

type Screen = "auth" | "loading" | "type" | "agents" | "chat" | "library" | "tasks";

interface SessionFull {
  id: string;
  project_type: ProjectType;
  agent_id: AgentId;
  title: string | null;
  challenger_mode: boolean;
  messages: ChatMessage[];
  updated_at: string;
}

export function App() {
  const supabase = createClient();
  const [screen, setScreen] = useState<Screen>("loading");
  const [userEmail, setUserEmail] = useState<string | undefined>();
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [archivedSessions, setArchivedSessions] = useState<SessionListItem[]>([]);
  const [activeSession, setActiveSession] = useState<SessionFull | null>(null);
  const [pendingType, setPendingType] = useState<ProjectType | null>(null);
  const [taskOpenCount, setTaskOpenCount] = useState(0);

  const loadSessions = useCallback(async () => {
    const { data } = await supabase
      .from("sessions")
      .select("id, agent_id, project_type, title, updated_at")
      .is("archived_at", null)
      .order("updated_at", { ascending: false });
    setSessions((data ?? []) as SessionListItem[]);
  }, [supabase]);

  const loadArchivedSessions = useCallback(async () => {
    const { data } = await supabase
      .from("sessions")
      .select("id, agent_id, project_type, title, updated_at")
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
      setScreen("type");
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
        .select("id, project_type, agent_id, title, challenger_mode, messages, updated_at")
        .eq("id", id)
        .single();
      if (error || !data) return;
      setActiveSession({
        id: data.id,
        project_type: data.project_type,
        agent_id: data.agent_id,
        title: data.title,
        challenger_mode: data.challenger_mode,
        messages: Array.isArray(data.messages) ? (data.messages as ChatMessage[]) : [],
        updated_at: data.updated_at,
      });
      setScreen("chat");
    },
    [supabase],
  );

  const startNewSession = useCallback(
    async (agentId: AgentId, type: ProjectType) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from("sessions")
        .insert({
          user_id: user.id,
          project_type: type,
          agent_id: agentId,
          challenger_mode: false,
          messages: [],
        })
        .select("id, project_type, agent_id, title, challenger_mode, messages, updated_at")
        .single();
      if (error || !data) return;

      setSessions((p) => [
        { id: data.id, agent_id: data.agent_id, project_type: data.project_type, title: data.title, updated_at: data.updated_at },
        ...p,
      ]);
      setActiveSession({
        id: data.id,
        project_type: data.project_type,
        agent_id: data.agent_id,
        title: data.title,
        challenger_mode: data.challenger_mode,
        messages: [],
        updated_at: data.updated_at,
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
        setScreen("type");
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
  }, []);

  if (screen === "loading") {
    return <div style={{ width: "100vw", height: "100vh", background: "#F6F8FC" }} />;
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
          setScreen("type");
        }}
      />
    );
  }

  const sidebarView: SidebarView =
    screen === "library" ? "library" : screen === "tasks" ? "tasks" : "chat";

  const renderMain = () => {
    if (screen === "type") {
      return (
        <TypeSelector
          onSelect={(t) => {
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
          onBack={() => setScreen("type")}
          onSelect={(agentId) => startNewSession(agentId, pendingType)}
        />
      );
    }
    if (screen === "library") {
      return <LibraryScreen onOpenSession={openSession} />;
    }
    if (screen === "tasks") {
      return <TasksScreen onOpenSession={openSession} />;
    }
    if (screen === "chat" && activeSession) {
      return (
        <ChatSession
          sessionId={activeSession.id}
          agentId={activeSession.agent_id}
          projectType={activeSession.project_type}
          initialMessages={activeSession.messages}
          initialChallenger={activeSession.challenger_mode}
          onBack={() => setScreen("type")}
          onTitleChange={handleTitleChange}
        />
      );
    }
    return null;
  };

  return (
    <div style={{ display: "flex", width: "100vw", height: "100vh", overflow: "hidden" }}>
      <Sidebar
        sessions={sessions}
        archivedSessions={archivedSessions}
        activeSessionId={activeSession?.id ?? null}
        currentView={sidebarView}
        taskOpenCount={taskOpenCount}
        onSelectSession={openSession}
        onNewSession={() => {
          setActiveSession(null);
          setPendingType(null);
          setScreen("type");
        }}
        onNavigate={navigate}
        onSignOut={handleSignOut}
        onArchiveSession={archiveSession}
        onRestoreSession={restoreSession}
        onDeleteSession={deleteSession}
        userEmail={userEmail}
      />
      <div style={{ flex: 1, display: "flex", overflow: "hidden", animation: "fndFadeIn 0.18s ease" }}>
        {renderMain()}
      </div>
    </div>
  );
}
