"use client";

import { useRouter } from "next/navigation";
import { AuthScreen } from "@/components/AuthScreen";

export default function SignupPage() {
  const router = useRouter();
  return (
    <AuthScreen
      initialView="signup"
      onBack={() => router.push("/")}
      onAuthenticated={() => router.push("/home")}
    />
  );
}
