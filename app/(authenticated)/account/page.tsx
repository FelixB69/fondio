"use client";

import { useRouter } from "next/navigation";
import { AccountScreen } from "@/components/AccountScreen";

export default function AccountPage() {
  const router = useRouter();
  return <AccountScreen onBack={() => router.back()} />;
}
