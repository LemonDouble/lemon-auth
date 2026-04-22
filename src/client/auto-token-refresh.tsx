"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./context.js";
import { refreshToken } from "./url.js";

export function AutoTokenRefresh({
  children,
  fallback,
}: {
  children?: React.ReactNode;
  fallback: React.ReactNode;
}) {
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "failed">("loading");

  useEffect(() => {
    if (isAuthenticated) return;

    let ignore = false;

    refreshToken().then((ok) => {
      if (ignore) return;
      if (ok) {
        router.refresh();
      } else {
        setStatus("failed");
      }
    });

    return () => {
      ignore = true;
    };
  }, [isAuthenticated, router]);

  if (isAuthenticated) return null;
  if (status === "loading") return fallback ?? null;
  return children ?? null;
}
