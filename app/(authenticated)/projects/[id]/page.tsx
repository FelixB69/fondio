"use client";

import { useParams, useRouter } from "next/navigation";
import { ProjectDetailScreen } from "@/components/ProjectDetailScreen";

export default function ProjectDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  return (
    <ProjectDetailScreen
      projectId={params.id}
      onBack={() => router.push("/projects")}
      onOpenSession={(id) => router.push(`/chat/${id}`)}
      onStartSession={(projectId, type) => router.push(`/agents?type=${type}&project=${projectId}`)}
    />
  );
}
