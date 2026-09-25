import { NextRequest, NextResponse } from "next/server";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  LOGIN_URL,
} from "../constants.js";
import { isMockAuthEnabled } from "../mock.js";

/**
 * 쿠키 exp 만 보고 라우팅만 한다. 서명 검증은 DAL, 갱신은 <SessionRestore /> 가 맡는다.
 * 여기에 네트워크 호출(갱신)을 넣지 말 것 — 프리페치마다 동시 갱신되어 refresh 회전 경쟁이 난다.
 */

const REFRESH_BUFFER_SECONDS = 60;

const AUTH_BYPASS_PATHS = [
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

/** 앱이 <SessionRestore /> 를 마운트해야 하는 경로. */
const RESTORE_PATH = "/auth/restore";

export type LoginRedirectUrl = string | ((request: NextRequest) => string);

export interface AuthProxyOptions {
  /** 로그인 없이 열어둘 경로. 익명이면 통과, 만료 세션이면 복구를 거친다. */
  publicPaths?: string[];
  /** 리다이렉트 대신 401 JSON 을 돌려줄 경로. 기본 `/api/*`. */
  apiPaths?: string[];
  loginRedirectUrl?: LoginRedirectUrl;
}

export function createAuthProxy(options: AuthProxyOptions = {}) {
  const {
    publicPaths = [],
    apiPaths = DEFAULT_API_PATHS,
    loginRedirectUrl,
  } = options;

  return async function proxy(request: NextRequest): Promise<NextResponse> {
    const { pathname } = request.nextUrl;

    // 복구 경로 자신은 항상 통과. 여기서 복구 경로로 보내면 무한 루프다.
    if (pathname === RESTORE_PATH) {
      return NextResponse.next();
    }

    if (isPublicPath(pathname, AUTH_BYPASS_PATHS)) {
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
        { code: "UNAUTHORIZED" },
        { status: 401 }
      );
    }

    // 서버 액션 등 비-GET 은 리다이렉트하면 깨지므로 DAL 이 거부하게 둔다.
    if (request.method !== "GET") {
      return NextResponse.next();
    }

    // refresh 가 남아 있으면 브라우저가 갱신하도록 복구 경로로 보낸다. 공개 경로도 포함.
    if (request.cookies.get(REFRESH_TOKEN_COOKIE)?.value) {
      const restore = new URL(RESTORE_PATH, request.url);
      restore.searchParams.set("next", pathname + request.nextUrl.search);
      return NextResponse.redirect(restore);
    }

    if (isPublic) {
      return NextResponse.next();
    }

    return redirectToLogin(request, loginRedirectUrl);
  };
}

/** exp 만 본다. 위조 토큰은 여기를 통과해도 DAL 에서 걸린다. */
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
