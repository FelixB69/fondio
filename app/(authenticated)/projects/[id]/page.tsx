"use client";

import { Suspense } from "react";
import { useParams, useRouter } from "next/navigation";
import { ProjectDetailScreen } from "@/components/ProjectDetailScreen";

function ProjectDetailPageContent() {
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

// L'écran lit `?tab=` et `?filter=` via useSearchParams : Next impose une
// frontière Suspense autour de tout composant client qui s'en sert.
export default function ProjectDetailPage() {
  return (
    <Suspense fallback={null}>
      <ProjectDetailPageContent />
    </Suspense>
  );
}
