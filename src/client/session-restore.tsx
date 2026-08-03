"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { refreshSession } from "./url.js";

/**
 * 토큰을 갱신하는 유일한 주체. 프록시가 만료된 세션을 이리로 보낸다.
 *
 * 갱신을 서버(미들웨어)가 아니라 브라우저가 하는 이유는 두 가지다.
 *
 *   1. 미들웨어는 요청마다 별도 인스턴스로 떠서 서로를 모른다. 프리페치가
 *      깔리면 같은 refresh token 으로 갱신이 동시에 나가고, 회전 경쟁이 난다.
 *      브라우저의 복구 경로는 한 번에 하나만 뜬다.
 *   2. 브라우저 요청에는 진짜 UA 와 WAF 통과 쿠키가 실린다. 서버간 fetch 는
 *      UA 가 런타임 기본값이라 봇 방어에 걸릴 수 있다.
 *
 * 끝나면 router 가 아니라 window.location 으로 next 에 간다. 소프트 네비는
 * 루트 레이아웃(과 AuthProvider)을 다시 렌더하지 않으므로, 옛 세션 스냅샷이
 * 남아 화면이 어긋나거나 라우터 캐시에 굳은 리다이렉트가 되살아난다.
 *
 * 실패해도 next 로 간다. 죽은 토큰이면 서버가 401 응답에서 세션 쿠키를
 * 지워 주므로(auth-server v2026.08.03.2+), 이후 판단 — 로그인으로 보낼지,
 * 익명으로 보여줄지 — 는 프록시와 DAL 이 알아서 한다.
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
        // 서버 · 네트워크 사정이다. 토큰은 살아 있을 수 있으므로
        // 로그인으로 보내지 않고 재시도만 권한다.
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

/**
 * next 파라미터는 사용자가 조작할 수 있으므로 열린 리다이렉트가 되지 않게
 * 같은 출처의 경로만 허용한다. `//evil.com` 은 브라우저가 프로토콜 상대
 * URL 로 읽으므로 반드시 걸러야 한다.
 */
function safeNextPath(next: string | null): string {
  if (!next) return "/";
  if (!next.startsWith("/")) return "/";
  if (next.startsWith("//")) return "/";
  return next;
}
