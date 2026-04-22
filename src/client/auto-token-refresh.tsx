"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./context.js";
import { refreshToken } from "./url.js";

export function AutoTokenRefresh({ children }: { children?: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isAuthenticated) return;

    let ignore = false;

    refreshToken().then((ok) => {
      if (!ignore && ok) {
        router.refresh();
      }
    });

    return () => {
      ignore = true;
    };
  }, [isAuthenticated, router]);

  if (isAuthenticated) return null;
  return children ?? null;
}
