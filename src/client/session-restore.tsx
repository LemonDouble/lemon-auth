"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { refreshSession } from "./url.js";

/**
 * 토큰 갱신의 유일한 주체. 브라우저에서 한 번만 갱신해 미들웨어의 동시 갱신 경쟁을 피한다.
 * 끝나면 루트 레이아웃까지 다시 렌더되도록 router 대신 window.location 으로 next 에 간다.
 */
export function SessionRestore({ fallback }: { fallback: React.ReactNode }) {
  const searchParams = useSearchParams();
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let ignore = false;
    const next = safeNextPath(searchParams.get("next"));

    refreshSession().then((result) => {
      if (ignore) return;

      if (result === "unavailable") {
        // 토큰은 살아 있을 수 있으므로 로그인으로 보내지 않고 재시도만 권한다.
        setUnavailable(true);
        return;
      }

      window.location.replace(next);
    });

    return () => {
      ignore = true;
    };
  }, [searchParams]);

  if (unavailable) {
    return (
      <div
        style={{
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
        }}
      >
        <p>인증 서버에 연결하지 못했습니다.</p>
        <button type="button" onClick={() => window.location.reload()}>
          다시 시도
        </button>
      </div>
    );
  }

  return fallback;
}

/** 열린 리다이렉트 방지: 같은 출처 경로만 허용한다. `//evil.com` 은 프로토콜 상대 URL 이다. */
function safeNextPath(next: string | null): string {
  if (!next) return "/";
  if (!next.startsWith("/")) return "/";
  if (next.startsWith("//")) return "/";
  return next;
}
