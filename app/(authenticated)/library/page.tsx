"use client";

import { useRouter } from "next/navigation";
import { LibraryScreen } from "@/components/LibraryScreen";

export default function LibraryPage() {
  const router = useRouter();
  return <LibraryScreen onOpenSession={(id) => router.push(`/chat/${id}`)} />;
}
