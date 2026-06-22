"use client";

import { useRouter } from "next/navigation";
import { LandingScreen } from "@/components/LandingScreen";

export default function Page() {
  const router = useRouter();
  return (
    <LandingScreen onLogin={() => router.push("/login")} onSignup={() => router.push("/signup")} />
  );
}
