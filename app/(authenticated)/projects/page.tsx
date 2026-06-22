"use client";

import { useRouter } from "next/navigation";
import { ProjectsScreen } from "@/components/ProjectsScreen";

export default function ProjectsPage() {
  const router = useRouter();
  return (
    <ProjectsScreen
      onOpenProject={(id) => router.push(`/projects/${id}`)}
      onStartSession={(projectId, type) => router.push(`/agents?type=${type}&project=${projectId}`)}
      onOpenSession={(id) => router.push(`/chat/${id}`)}
    />
  );
}
