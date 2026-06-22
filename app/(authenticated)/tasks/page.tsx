"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { TasksScreen } from "@/components/TasksScreen";
import { useAppData } from "@/components/AppDataProvider";

export default function TasksPage() {
  const router = useRouter();
  const { loadTaskCount } = useAppData();

  useEffect(() => {
    loadTaskCount();
  }, [loadTaskCount]);

  return <TasksScreen onOpenSession={(id) => router.push(`/chat/${id}`)} />;
}
