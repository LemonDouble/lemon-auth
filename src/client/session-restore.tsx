"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "./context.js";
import { loginUrl, refreshToken } from "./url.js";

/**
 * 토큰을 갱신하는 유일한 주체.
 *
 * 프록시는 쿠키만 읽고, access 가 만료됐는데 refresh 가 남아 있으면 이 경로로
 * 보낸다. 여기서 브라우저가 직접 갱신한 뒤 원래 가려던 곳으로 돌려보낸다.
 *
 * 갱신을 서버(미들웨어)가 아니라 브라우저가 하는 이유는 두 가지다.
 *
 *   1. 미들웨어는 요청마다 별도 인스턴스로 떠서 서로를 모른다. 프리페치가
 *      깔리면 같은 refresh token 으로 갱신이 동시에 나가고, 회전 경쟁이 난다.
 *      브라우저는 JS 컨텍스트가 하나라 이 문제가 없다.
 *   2. 브라우저 요청에는 진짜 UA 와 WAF 통과 쿠키가 실린다. 서버간 fetch 는
 *      UA 가 런타임 기본값이라 봇 방어에 걸릴 수 있다.
 *
 * 앱은 이 컴포넌트를 프록시의 `restorePath`(기본 `/auth/restore`)에 마운트하고,
 * 그 경로를 `publicPaths` 에 넣어야 한다. 안 그러면 프록시가 복구 경로 자신을
 * 다시 복구 경로로 보내 무한 루프가 된다.
 */
export function SessionRestore({
  fallback,
  failedRedirectUrl,
}: {
  /** 갱신하는 동안 보여줄 것. */
  fallback: React.ReactNode;
  /** 갱신 실패 시 보낼 곳. 기본은 로그인. */
  failedRedirectUrl?: string;
}) {
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let ignore = false;
    const next = safeNextPath(searchParams.get("next"));

    // 이미 세션이 살아 있으면 갱신하지 않는다. 만료 구간에 굳은 리다이렉트를
    // 뒤늦게 따라오는 경우가 있는데, 그때마다 토큰을 회전시키면 회전 경쟁의
    // 빌미만 늘린다.
    if (isAuthenticated) {
      router.replace(next);
      return;
    }

    refreshToken().then((ok) => {
      if (ignore) return;

      if (ok) {
        router.replace(next);
        return;
      }

      // 갱신이 실패했으면 refresh token 이 죽은 것이다. 다시 시도해봐야
      // 같은 결과이므로 로그인으로 보낸다. 여기서 복구 경로로 되돌리면
      // 무한 루프가 된다.
      setFailed(true);
      window.location.href =
        failedRedirectUrl ?? loginUrl(window.location.origin);
    });

    return () => {
      ignore = true;
    };
  }, [isAuthenticated, router, searchParams, failedRedirectUrl]);

  if (failed) return null;
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
