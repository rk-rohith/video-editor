"use client";

import { useAuthStore } from "@/store/auth";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function HomePage() {
  const router = useRouter();
  const accessToken = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    router.replace(accessToken ? "/projects" : "/login");
  }, [accessToken, router]);

  return (
    <div className="flex h-screen items-center justify-center text-textMuted">
      <p>Loading…</p>
    </div>
  );
}
