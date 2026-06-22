"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AgentId, ChatMessage, ProjectType } from "@/lib/data";
import { createClient } from "@/lib/supabase/client";
import { SessionListItem } from "./Sidebar";

export interface SessionFull {
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

interface AppDataContextValue {
  sessions: SessionListItem[];
  archivedSessions: SessionListItem[];
  taskOpenCount: number;
  userEmail: string | undefined;
  loadSessions: () => Promise<void>;
  loadArchivedSessions: () => Promise<void>;
  loadTaskCount: () => Promise<void>;
  fetchSessionById: (id: string) => Promise<SessionFull | null>;
  startNewSession: (
    agentIdOrIds: AgentId | AgentId[],
    type: ProjectType,
    projectId?: string | null,
  ) => Promise<string | null>;
  archiveSession: (id: string) => Promise<void>;
  restoreSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  handleTitleChange: (sessionId: string, title: string) => void;
  linkingSessionId: string | null;
  setLinkingSessionId: (id: string | null) => void;
}

const AppDataContext = createContext<AppDataContextValue | null>(null);

export function useAppData(): AppDataContextValue {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error("useAppData doit être utilisé sous AppDataProvider");
  return ctx;
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;

  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [archivedSessions, setArchivedSessions] = useState<SessionListItem[]>([]);
  const [taskOpenCount, setTaskOpenCount] = useState(0);
  const [userEmail, setUserEmail] = useState<string | undefined>();
  const [linkingSessionId, setLinkingSessionId] = useState<string | null>(null);

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
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      setUserEmail(session?.user.email ?? undefined);
    })();
    loadSessions();
    loadArchivedSessions();
    loadTaskCount();

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      if (!session) {
        router.replace("/");
        return;
      }
      setUserEmail(session.user.email ?? undefined);
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase, loadSessions, loadArchivedSessions, loadTaskCount, router]);

  const fetchSessionById = useCallback(
    async (id: string): Promise<SessionFull | null> => {
      const { data, error } = await supabase
        .from("sessions")
        .select("id, project_type, project_id, agent_id, title, challenger_mode, messages, updated_at, panel_agent_ids")
        .eq("id", id)
        .single();
      if (error || !data) return null;
      return {
        id: data.id,
        project_type: data.project_type,
        project_id: data.project_id ?? null,
        agent_id: data.agent_id,
        title: data.title,
        challenger_mode: data.challenger_mode,
        messages: Array.isArray(data.messages) ? (data.messages as ChatMessage[]) : [],
        updated_at: data.updated_at,
        panel_agent_ids: Array.isArray(data.panel_agent_ids) ? data.panel_agent_ids : null,
      };
    },
    [supabase],
  );

  const startNewSession = useCallback(
    async (agentIdOrIds: AgentId | AgentId[], type: ProjectType, projectId: string | null = null) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return null;

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
        .select("id, project_type, project_id, agent_id, title, updated_at, panel_agent_ids")
        .single();
      if (error || !data) return null;

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
      return data.id as string;
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
      setSessions((p) => {
        const archived = p.find((s) => s.id === id);
        if (archived) setArchivedSessions((a) => [archived, ...a]);
        return p.filter((s) => s.id !== id);
      });
    },
    [supabase],
  );

  const restoreSession = useCallback(
    async (id: string) => {
      const { error } = await supabase
        .from("sessions")
        .update({ archived_at: null })
        .eq("id", id);
      if (error) return;
      setArchivedSessions((p) => {
        const restored = p.find((s) => s.id === id);
        if (restored) setSessions((s) => [restored, ...s]);
        return p.filter((s) => s.id !== id);
      });
    },
    [supabase],
  );

  const deleteSession = useCallback(
    async (id: string) => {
      const { error } = await supabase.from("sessions").delete().eq("id", id);
      if (error) return;
      setArchivedSessions((p) => p.filter((s) => s.id !== id));
    },
    [supabase],
  );

  const handleTitleChange = useCallback((sessionId: string, title: string) => {
    setSessions((list) =>
      list.map((s) => (s.id === sessionId ? { ...s, title, updated_at: new Date().toISOString() } : s)),
    );
  }, []);

  return (
    <AppDataContext.Provider
      value={{
        sessions,
        archivedSessions,
        taskOpenCount,
        userEmail,
        loadSessions,
        loadArchivedSessions,
        loadTaskCount,
        fetchSessionById,
        startNewSession,
        archiveSession,
        restoreSession,
        deleteSession,
        handleTitleChange,
        linkingSessionId,
        setLinkingSessionId,
      }}
    >
      {children}
    </AppDataContext.Provider>
  );
}
