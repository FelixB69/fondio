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
  const { fetchSessionById, handleTitleChange, setLinkingSessionId } = useAppData();
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

  const panelIds = session.panel_agent_ids;
  if (panelIds && panelIds.length > 1) {
    return (
      <MultiAgentSession
        sessionId={session.id}
        panelAgentIds={panelIds as AgentId[]}
        projectType={session.project_type}
        initialMessages={session.messages}
        onBack={() => router.push("/home")}
        onTitleChange={(title) => handleTitleChange(session.id, title)}
      />
    );
  }

  return (
    <ChatSession
      sessionId={session.id}
      agentId={session.agent_id}
      projectType={session.project_type}
      projectId={session.project_id}
      initialMessages={session.messages}
      initialChallenger={session.challenger_mode}
      onBack={() => router.push("/home")}
      onTitleChange={(title) => handleTitleChange(session.id, title)}
      onLinkProject={() => setLinkingSessionId(session.id)}
    />
  );
}
