"use client";

import { useRouter } from "next/navigation";
import { ProjectPickerScreen } from "@/components/ProjectPickerScreen";

export default function ProjectPickerPage() {
  const router = useRouter();
  return (
    <ProjectPickerScreen
      onPickProject={(projectId, type) => router.push(`/agents?type=${type}&project=${projectId}`)}
      onSkip={() => router.push("/type")}
    />
  );
}
