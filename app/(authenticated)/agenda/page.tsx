"use client";

import { useRouter } from "next/navigation";
import { AgendaScreen } from "@/components/AgendaScreen";

export default function AgendaPage() {
  const router = useRouter();
  return <AgendaScreen onOpenSession={(id) => router.push(`/chat/${id}`)} />;
}
