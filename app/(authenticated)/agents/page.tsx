"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AgentSelector } from "@/components/AgentSelector";
import { useAppData } from "@/components/AppDataProvider";
import { AgentId, ProjectType } from "@/lib/data";

function AgentsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { startNewSession } = useAppData();

  const type = searchParams.get("type") as ProjectType | null;
  const projectId = searchParams.get("project");

  useEffect(() => {
    if (type !== "perso" && type !== "pro") router.replace("/type");
  }, [type, router]);

  if (type !== "perso" && type !== "pro") return null;

  return (
    <AgentSelector
      type={type}
      onBack={() => router.back()}
      onSelect={async (agentIdOrIds: AgentId | AgentId[]) => {
        const id = await startNewSession(agentIdOrIds, type, projectId);
        if (id) router.push(`/chat/${id}`);
      }}
    />
  );
}

export default function AgentsPage() {
  return (
    <Suspense fallback={null}>
      <AgentsPageContent />
    </Suspense>
  );
}
