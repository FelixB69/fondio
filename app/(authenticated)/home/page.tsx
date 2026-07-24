"use client";

import { useRouter } from "next/navigation";
import { useAppData } from "@/components/AppDataProvider";
import { ProjectPickerScreen } from "@/components/ProjectPickerScreen";

export default function ProjectPickerPage() {
  const router = useRouter();
  const { startNewSession } = useAppData();

  // Mode Accompagné : on ouvre une session guidée avec Clara (Chef de projet),
  // SANS créer de projet ni demander de type — une description vague donnerait
  // un projet fantôme mal nommé. Le type reste "other" jusqu'au cadrage, et le
  // projet est proposé plus tard dans le chat, une fois la matière réunie.
  const startGuided = async (description: string) => {
    const id = await startNewSession("pm", "other", null, { guided: true });
    if (!id) return;
    // La description transite par sessionStorage plutôt que par l'URL : elle
    // peut être longue, et ChatSession l'enverra automatiquement au 1er rendu.
    window.sessionStorage.setItem(`fnd_kickoff_${id}`, description);
    router.push(`/chat/${id}`);
  };

  return (
    <ProjectPickerScreen
      onGuidedStart={startGuided}
      onPickProject={(projectId, type) => router.push(`/agents?type=${type}&project=${projectId}`)}
      onSkip={() => router.push("/type")}
    />
  );
}
