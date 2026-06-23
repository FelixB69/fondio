"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ChatSession } from "@/components/ChatSession";
import { MultiAgentSession } from "@/components/MultiAgentSession";
import { useAppData, type SessionFull } from "@/components/AppDataProvider";
import { AgentId } from "@/lib/data";

export default function ChatPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const {
    fetchSessionById,
    handleTitleChange,
    setLinkingSessionId,
    sessions,
    archivedSessions,
    projectsById,
  } = useAppData();
  const [session, setSession] = useState<SessionFull | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSession(null);
    setNotFound(false);
    (async () => {
      const data = await fetchSessionById(params.id);
      if (cancelled) return;
      if (!data) {
        setNotFound(true);
        return;
      }
      setSession(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [params.id, fetchSessionById]);

  useEffect(() => {
    if (notFound) router.replace("/home");
  }, [notFound, router]);

  if (!session) return null;

  // Le rattachement vit dans le provider (mis à jour à chaque lien/délien) :
  // on lit le project_id "vivant" depuis les listes plutôt que le snapshot
  // chargé une seule fois, pour que le header se mette à jour instantanément.
  const liveProjectId =
    sessions.find((s) => s.id === session.id)?.project_id ??
    archivedSessions.find((s) => s.id === session.id)?.project_id ??
    session.project_id;
  const project = liveProjectId ? projectsById[liveProjectId] ?? null : null;

  const panelIds = session.panel_agent_ids;
  if (panelIds && panelIds.length > 1) {
    return (
      <MultiAgentSession
        sessionId={session.id}
        panelAgentIds={panelIds as AgentId[]}
        projectType={session.project_type}
        projectId={liveProjectId}
        project={project}
        initialMessages={session.messages}
        initialChallenger={session.challenger_mode}
        onBack={() => router.push("/home")}
        onTitleChange={(title) => handleTitleChange(session.id, title)}
        onLinkProject={() => setLinkingSessionId(session.id)}
      />
    );
  }

  return (
    <ChatSession
      sessionId={session.id}
      agentId={session.agent_id}
      projectType={session.project_type}
      projectId={liveProjectId}
      project={project}
      initialMessages={session.messages}
      initialChallenger={session.challenger_mode}
      onBack={() => router.push("/home")}
      onTitleChange={(title) => handleTitleChange(session.id, title)}
      onLinkProject={() => setLinkingSessionId(session.id)}
    />
  );
}
