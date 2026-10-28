import { NextResponse, type NextRequest } from "next/server";
import { AUTH_ROUTE_PREFIX, SESSION_COOKIE } from "../constants.js";
import { isMockAuthEnabled } from "../mock.js";
import { loginUrl } from "../client/url.js";
import { deleteCookie, setCookie } from "../sealed-cookie.js";
import {
  SESSION_MAX_AGE_SECONDS,
  isExpired,
  needsRefresh,
  refreshSession,
  sealSession,
  unsealSession,
} from "../session.js";

/**
 * access token 만료 시각이 다가오면 refresh 로 세션을 갱신하고 쿠키를 바꾼다.
 * 서버 컴포넌트는 쿠키를 쓸 수 없어서, 갱신은 여기서 한다.
 * 앱 client 는 confidential 이라 refresh token 이 회전하지 않으므로, 프리페치가 겹쳐 동시에 갱신해도 된다.
 * 권한 판단은 각 페이지와 서버 액션의 getSession() / requireSession() 이 한다.
 */

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

const DEFAULT_API_PATHS = ["/api/*"];

export interface AuthProxyOptions {
  /** 로그인 없이 열어 둘 경로 */
  publicPaths?: string[];
  /** 로그인으로 보내는 대신 401 JSON 을 돌려줄 경로. 기본 `/api/*`. */
  apiPaths?: string[];
}

export function createAuthProxy(options: AuthProxyOptions = {}) {
  const { publicPaths = [], apiPaths = DEFAULT_API_PATHS } = options;

  return async function proxy(request: NextRequest): Promise<NextResponse> {
    const { pathname } = request.nextUrl;
    if (
      pathname.startsWith(AUTH_ROUTE_PREFIX) ||
      matchesPath(pathname, AUTH_BYPASS_PATHS) ||
      isMockAuthEnabled() ||
      hasBearerToken(request)
    ) {
      return NextResponse.next();
    }

    const sessionCookie = request.cookies.get(SESSION_COOKIE)?.value;
    const session = await unsealSession(sessionCookie);
    if (session && !needsRefresh(session)) return NextResponse.next();

    const refresh = session ? await refreshSession(session) : null;
    if (refresh?.type === "refreshed") {
      const sealed = await sealSession(refresh.session);
      // 이번 요청을 처리하는 페이지도 갱신한 세션을 읽도록 요청 쿠키도 바꾼다.
      request.cookies.set(SESSION_COOKIE, sealed);
      const response = NextResponse.next({ request: { headers: request.headers } });
      setCookie(response, SESSION_COOKIE, sealed, SESSION_MAX_AGE_SECONDS);
      return response;
    }
    // auth 서버에 닿지 못했으면 세션을 두고, 만료 전이면 그대로 쓴다. 다음 요청에서 다시 갱신한다.
    const isRefreshUnavailable = refresh?.type === "unavailable";
    const isSessionUsable = isRefreshUnavailable && session !== null && !isExpired(session);
    // 열 수 없는 쿠키나 OP 가 끝낸 세션은 브라우저와 이번 요청에서 모두 지운다.
    const shouldDeleteCookie = sessionCookie !== undefined && !isRefreshUnavailable;
    if (shouldDeleteCookie) request.cookies.delete(SESSION_COOKIE);

    let response: NextResponse;
    if (isSessionUsable || matchesPath(pathname, publicPaths)) {
      response = NextResponse.next({ request: { headers: request.headers } });
    } else if (matchesPath(pathname, apiPaths)) {
      // API 는 리다이렉트를 따라가 봐야 HTML 을 받을 뿐이라 401 을 준다.
      response = NextResponse.json({ code: "UNAUTHORIZED" }, { status: 401 });
    } else if (request.method !== "GET") {
      // 서버 액션처럼 GET 이 아닌 요청은 리다이렉트하면 깨지므로 페이지 쪽 확인에 맡긴다.
      response = NextResponse.next({ request: { headers: request.headers } });
    } else {
      response = NextResponse.redirect(new URL(loginUrl(pathname + request.nextUrl.search), request.nextUrl.origin));
    }
    if (shouldDeleteCookie) deleteCookie(response, SESSION_COOKIE);
    return response;
  };
}

/** lemon-cli 처럼 쿠키 없이 Bearer 로 오는 요청. 검증은 라우트의 verifyBearerToken() 이 한다. */
function hasBearerToken(request: NextRequest): boolean {
  return request.headers.get("authorization")?.toLowerCase().startsWith("bearer ") ?? false;
}

function matchesPath(pathname: string, patterns: string[]): boolean {
  return patterns.some((pattern) =>
    pattern.endsWith("*") ? pathname.startsWith(pattern.slice(0, -1)) : pathname === pattern
  );
}
