import { NextRequest, NextResponse } from "next/server";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  LOGIN_URL,
} from "../constants.js";
import { isMockAuthEnabled } from "../mock.js";

/**
 * 프록시는 optimistic check 만 한다.
 *
 * Next.js 공식 인증 가이드가 이렇게 못박고 있다.
 *
 *   since Proxy runs on every route, including prefetched routes, it's
 *   important to only read the session from the cookie (optimistic checks),
 *   and avoid database checks to prevent performance issues.
 *
 * 0.7.x 까지는 여기서 auth 서버로 refresh 요청을 보냈다. 그 결과 프리페치가
 * 깔릴 때마다 갱신이 동시에 여러 번 나갔고, Vercel 미들웨어는 요청마다 별도
 * 인스턴스로 뜨므로 직렬화할 방법도 없었다. 회전 경쟁이 나서 정상 요청이
 * 탈취로 오인되고 계정 토큰이 통째로 폐기되는 일이 반복됐다.
 *
 * 그래서 갱신 주체를 브라우저 하나로 옮겼다. 브라우저는 JS 컨텍스트가 하나라
 * 자연히 직렬화된다. 프록시는 쿠키만 읽고, 갱신이 필요하면 앱이 마운트한
 * 복구 경로로 넘긴다.
 *
 * 서명 검증도 하지 않는다. optimistic check 는 보안 판단이 아니라 화면 이동
 * 판단이다. 진짜 검증은 DAL(getSession / requireApprovedUser)이 한다.
 */

const REFRESH_BUFFER_SECONDS = 60;

export const DEFAULT_AUTH_BYPASS_PATHS = [
  "/sw.js",
  "/service-worker.js",
  "/manifest.webmanifest",
  "/manifest.json",
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml",
  "/browserconfig.xml",
  "/apple-touch-icon.png",
  "/apple-touch-icon-*",
  "/icon-*",
  "/icons/*",
];

export const DEFAULT_API_PATHS = ["/api/*"];

/** 앱이 <SessionRestore /> 를 마운트해야 하는 기본 경로. */
export const DEFAULT_RESTORE_PATH = "/auth/restore";

export const PROXY_AUTH_ERROR = {
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
} as const;
export type ProxyAuthErrorCode =
  (typeof PROXY_AUTH_ERROR)[keyof typeof PROXY_AUTH_ERROR];

export type LoginRedirectUrl = string | ((request: NextRequest) => string);

export interface AuthProxyOptions {
  /** 로그인 없이 열어둘 경로. 여기서는 아무 판단도 하지 않고 통과시킨다. */
  publicPaths?: string[];
  /** 프록시 자체를 건너뛸 경로. 정적 파일 등. */
  bypassPaths?: string[];
  /** 리다이렉트 대신 401 JSON 을 돌려줄 경로. 기본 `/api/*`. */
  apiPaths?: string[];
  loginRedirectUrl?: LoginRedirectUrl;
  /** <SessionRestore /> 를 마운트한 경로. 기본 `/auth/restore`. */
  restorePath?: string;
}

export function createAuthProxy(options: AuthProxyOptions = {}) {
  const {
    publicPaths = [],
    bypassPaths = [],
    apiPaths = DEFAULT_API_PATHS,
    loginRedirectUrl,
    restorePath = DEFAULT_RESTORE_PATH,
  } = options;
  const effectiveBypassPaths = [...DEFAULT_AUTH_BYPASS_PATHS, ...bypassPaths];

  return async function proxy(request: NextRequest): Promise<NextResponse> {
    const { pathname } = request.nextUrl;

    if (isPublicPath(pathname, effectiveBypassPaths)) {
      return NextResponse.next();
    }

    if (isPublicPath(pathname, publicPaths)) {
      return NextResponse.next();
    }

    if (isMockAuthEnabled()) {
      return NextResponse.next();
    }

    const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
    if (accessToken && isTokenFresh(accessToken)) {
      return NextResponse.next();
    }

    const isApiRequest = isPublicPath(pathname, apiPaths);
    if (isApiRequest) {
      // API 는 리다이렉트를 따라가봐야 HTML 을 받을 뿐이다. 401 을 주고
      // 클라이언트가 복구하게 한다.
      return NextResponse.json(
        { code: PROXY_AUTH_ERROR.UNAUTHORIZED },
        { status: 401 }
      );
    }

    // access 는 없지만 refresh 가 남아 있으면 아직 로그인이 풀린 게 아니다.
    // 브라우저가 갱신할 수 있도록 복구 경로로 보낸다.
    //
    // 프리페치도 똑같이 처리한다. 프리페치를 그냥 통과시키면 만료된 토큰으로
    // 페이지가 렌더되고, 거기서 나온 redirect 가 라우터 캐시에 굳어 어느 탭을
    // 눌러도 같은 곳으로 튀게 된다(예전에 겪은 문제다). 반면 여기서 돌려주는
    // 리다이렉트는 굳어도 해가 없다 — 복구 경로는 막다른 길이 아니라 스스로
    // 세션을 되살리고 next 로 되돌려 보내므로 목적지도 보존된다.
    if (request.cookies.get(REFRESH_TOKEN_COOKIE)?.value) {
      const restore = new URL(restorePath, request.url);
      restore.searchParams.set("next", pathname + request.nextUrl.search);
      return NextResponse.redirect(restore);
    }

    return redirectToLogin(request, loginRedirectUrl);
  };
}

/**
 * exp 만 본다. 서명은 검증하지 않는다.
 *
 * 위조한 토큰으로 이 검사를 통과할 수는 있으나, 그래봐야 DAL 에서 걸린다.
 * 프록시의 판단은 "어느 화면으로 보낼까" 이지 "권한이 있는가" 가 아니다.
 */
function isTokenFresh(token: string): boolean {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString()
    ) as { exp?: unknown };
    return (
      typeof payload.exp === "number" &&
      payload.exp > Math.floor(Date.now() / 1000) + REFRESH_BUFFER_SECONDS
    );
  } catch {
    return false;
  }
}

function isPublicPath(pathname: string, publicPaths: string[]): boolean {
  return publicPaths.some((p) => {
    if (p.endsWith("*")) {
      return pathname.startsWith(p.slice(0, -1));
    }
    return pathname === p;
  });
}

function redirectToLogin(
  request: NextRequest,
  loginRedirectUrl: LoginRedirectUrl | undefined
): NextResponse {
  const redirectUrl =
    typeof loginRedirectUrl === "function"
      ? loginRedirectUrl(request)
      : loginRedirectUrl;

  if (redirectUrl) {
    const url = `${LOGIN_URL}?redirect_url=${encodeURIComponent(redirectUrl)}`;
    return NextResponse.redirect(new URL(url, request.url));
  }
  return NextResponse.redirect(new URL("/", request.url));
}
