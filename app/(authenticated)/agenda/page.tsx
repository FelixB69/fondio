"use client";

import { Suspense } from "react";
import { useRouter } from "next/navigation";
import { AgendaScreen } from "@/components/AgendaScreen";

export default function AgendaPage() {
  const router = useRouter();
  return (
    <Suspense fallback={null}>
      <AgendaScreen onOpenSession={(id) => router.push(`/chat/${id}`)} />
    </Suspense>
  );
}
