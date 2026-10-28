import { isbot } from "isbot";
import { NextResponse, type NextRequest } from "next/server";
import {
  AUTH_ROUTE_PREFIX,
  SESSION_COOKIE,
  SILENT_LOGIN_ATTEMPTED_COOKIE,
  SILENT_LOGIN_SKIP_PARAM,
} from "../constants.js";
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
  /** 세션이 없을 때 OP 세션이 있는지 화면 없이 한 번 확인할 공개 경로 (예: 로그인 버튼이 있는 첫 화면) */
  silentLoginPaths?: string[];
}

export function createAuthProxy(options: AuthProxyOptions = {}) {
  const { publicPaths = [], apiPaths = DEFAULT_API_PATHS, silentLoginPaths = [] } = options;

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
    if (!isSessionUsable && matchesPath(pathname, silentLoginPaths) && canTrySilentLogin(request)) {
      const silentLoginUrl = new URL(loginUrl(pathname + request.nextUrl.search), request.nextUrl.origin);
      silentLoginUrl.searchParams.set("prompt", "none");
      response = NextResponse.redirect(silentLoginUrl);
      setCookie(response, SILENT_LOGIN_ATTEMPTED_COOKIE, "1");
    } else if (isSessionUsable || matchesPath(pathname, publicPaths)) {
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

/**
 * 다른 앱에서 로그인해 OP 세션이 있으면 공개 첫 화면에서도 화면 없이 로그인되도록, 브라우저마다 한 번 prompt=none 으로 확인한다.
 * 사용자가 화면을 직접 연 요청에서만 시도한다.
 * - Sec-Fetch-Mode/Dest: 화면을 여는 요청이다 (https://www.w3.org/TR/fetch-metadata/). 헤더가 없는 오래된 브라우저는 시도하지 않는다.
 * - Sec-Purpose, Purpose, X-Moz: 프리페치·프리렌더는 사용자가 아직 들어오지 않았다.
 * - isbot: 브라우저와 같은 헤더를 보내는 크롤러(Googlebot 렌더러 등)와 링크 미리보기 봇을 뺀다.
 * - 리다이렉트 체인 안에서는 Sec-Fetch-* 가 처음 값 그대로라 OP 를 다녀온 요청을 헤더로 가를 수 없다.
 *   반복은 시도 표시 쿠키로 막고, 쿠키를 저장하지 못하는 브라우저는 콜백이 붙이는 표시로 막는다.
 */
function canTrySilentLogin(request: NextRequest): boolean {
  const { headers } = request;
  return (
    request.method === "GET" &&
    headers.get("sec-fetch-mode") === "navigate" &&
    headers.get("sec-fetch-dest") === "document" &&
    !headers.has("sec-purpose") &&
    !headers.has("purpose") &&
    !headers.has("x-moz") &&
    !isbot(headers.get("user-agent")) &&
    !request.cookies.has(SILENT_LOGIN_ATTEMPTED_COOKIE) &&
    !request.nextUrl.searchParams.has(SILENT_LOGIN_SKIP_PARAM)
  );
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
