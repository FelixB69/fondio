"use client";

import { useRouter } from "next/navigation";
import { TypeSelector } from "@/components/TypeSelector";

export default function TypePage() {
  const router = useRouter();
  return (
    <TypeSelector
      onSelect={(t) => router.push(`/agents?type=${t}`)}
      onBack={() => router.back()}
    />
  );
}
