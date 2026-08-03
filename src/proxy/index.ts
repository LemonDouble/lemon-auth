import { NextRequest, NextResponse } from "next/server";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  LOGIN_URL,
} from "../constants.js";
import { isMockAuthEnabled } from "../mock.js";

/**
 * 프록시는 라우팅 결정만 한다: 신선하면 통과, 아니면 복구 경로로.
 *
 * Next.js 공식 인증 가이드의 optimistic check 다. 프리페치를 포함한 모든
 * 요청에서 돌기 때문에 쿠키의 exp 만 읽고, 네트워크 · DB · 서명 검증을
 * 하지 않는다. 보안 판단은 DAL(getSession / requireAuth)이 한다.
 *
 * 갱신 주체는 restorePath 에 마운트된 <SessionRestore /> 하나뿐이다.
 * 공개 경로도 refresh 쿠키가 남아 있으면 복구를 거치게 해서, 만료된 세션이
 * "로그아웃 상태로 렌더됐다가 뒤늦게 뒤집히는" 화면을 없앤다. (0.8.x 까지는
 * 이 몫을 레이아웃의 <AutoTokenRefresh /> 가 맡았는데, 복구 경로와 갱신
 * 주체가 둘이 되는 문제가 있었다)
 *
 * 0.7.x 까지는 프록시가 직접 auth 서버로 갱신을 보냈다. 미들웨어는 요청마다
 * 별도 인스턴스로 떠서 직렬화가 안 되므로, 프리페치가 겹치면 같은 refresh
 * token 으로 갱신이 동시에 나가 회전 경쟁이 났고 계정 토큰이 통째로
 * 폐기되는 일이 반복됐다. 다시 여기에 네트워크 호출을 넣지 말 것.
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
  /** 로그인 없이 열어둘 경로. 익명이면 통과, 만료 세션이면 복구를 거친다. */
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

    // 복구 경로 자신은 항상 통과. 여기서 복구 경로로 보내면 무한 루프다.
    if (pathname === restorePath) {
      return NextResponse.next();
    }

    if (isPublicPath(pathname, effectiveBypassPaths)) {
      return NextResponse.next();
    }

    if (isMockAuthEnabled()) {
      return NextResponse.next();
    }

    const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
    if (accessToken && isTokenFresh(accessToken)) {
      return NextResponse.next();
    }

    // --- 여기부터는 access token 이 없거나 만료가 임박한 요청 ---

    const isPublic = isPublicPath(pathname, publicPaths);

    if (isPublicPath(pathname, apiPaths)) {
      // API 는 리다이렉트를 따라가봐야 HTML 을 받을 뿐이다. 401 을 주고
      // 클라이언트가 복구하게 한다.
      if (isPublic) {
        return NextResponse.next();
      }
      return NextResponse.json(
        { code: PROXY_AUTH_ERROR.UNAUTHORIZED },
        { status: 401 }
      );
    }

    // 서버 액션 등 비-GET 을 리다이렉트하면 액션 프로토콜이 깨진다.
    // 통과시키고 DAL 이 거부하게 둔다.
    if (request.method !== "GET") {
      return NextResponse.next();
    }

    // refresh 가 남아 있으면 아직 로그인이 풀린 게 아니다. 브라우저가
    // 갱신할 수 있도록 복구 경로로 보낸다. 프리페치가 이 리다이렉트를
    // 캐시에 굳혀도 해가 없다 — 복구 경로는 스스로 세션을 되살리고
    // next 로 되돌려 보내므로 목적지가 보존된다.
    if (request.cookies.get(REFRESH_TOKEN_COOKIE)?.value) {
      const restore = new URL(restorePath, request.url);
      restore.searchParams.set("next", pathname + request.nextUrl.search);
      return NextResponse.redirect(restore);
    }

    if (isPublic) {
      return NextResponse.next();
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
