import { NextRequest, NextResponse } from "next/server";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  DEVICE_ID_COOKIE,
  AUTH_SERVER_URL,
  REFRESH_URL,
  JWKS_URL,
  LOGIN_URL,
} from "../constants.js";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AccessTokenClaims } from "../types.js";
import { isAccessTokenClaims } from "../claims.js";
import { isApprovedClient } from "../approval.js";
import { getMockAccessTokenClaims } from "../mock.js";

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

export const PROXY_AUTH_ERROR = {
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
} as const;
export type ProxyAuthErrorCode =
  (typeof PROXY_AUTH_ERROR)[keyof typeof PROXY_AUTH_ERROR];

const jwks = createRemoteJWKSet(new URL(JWKS_URL));

export type LoginRedirectUrl = string | ((request: NextRequest) => string);

export interface AuthProxyOptions {
  publicPaths?: string[];
  bypassPaths?: string[];
  apiPaths?: string[];
  clientId?: string;
  loginRedirectUrl?: LoginRedirectUrl;
  unapprovedRedirectUrl?: LoginRedirectUrl;
  onAuthSuccess?: (
    claims: AccessTokenClaims,
    request: NextRequest,
    response: NextResponse
  ) => Promise<NextResponse> | NextResponse;
}

export function createAuthProxy(options: AuthProxyOptions = {}) {
  const {
    publicPaths = [],
    bypassPaths = [],
    apiPaths = DEFAULT_API_PATHS,
    clientId,
    loginRedirectUrl,
    unapprovedRedirectUrl,
    onAuthSuccess,
  } = options;
  const effectiveBypassPaths = [
    ...DEFAULT_AUTH_BYPASS_PATHS,
    ...bypassPaths,
  ];

  return async function proxy(request: NextRequest): Promise<NextResponse> {
    const { pathname } = request.nextUrl;

    if (isPublicPath(pathname, effectiveBypassPaths)) {
      return NextResponse.next();
    }

    if (isPublicPath(pathname, publicPaths)) {
      return maybeRefreshAndContinue(request);
    }

    const isApiRequest = isPublicPath(pathname, apiPaths);
    const mockClaims = getMockAccessTokenClaims();
    if (mockClaims) {
      return handleVerifiedClaims(
        mockClaims,
        request,
        isApiRequest,
        clientId,
        unapprovedRedirectUrl,
        onAuthSuccess,
        NextResponse.next()
      );
    }

    const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
    const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
    const deviceId = request.cookies.get(DEVICE_ID_COOKIE)?.value;

    if (accessToken && isTokenFresh(accessToken)) {
      const claims = await verifyToken(accessToken);
      if (claims) {
        return handleVerifiedClaims(
          claims,
          request,
          isApiRequest,
          clientId,
          unapprovedRedirectUrl,
          onAuthSuccess,
          NextResponse.next()
        );
      }
    }

    if (refreshToken) {
      const result = await tryRefresh(refreshToken, deviceId);
      if (result) {
        const claims = await verifyToken(result.newAccessToken);
        if (claims) {
          const response = nextWithRefreshedCookies(
            request,
            result.setCookieHeaders
          );
          return handleVerifiedClaims(
            claims,
            request,
            isApiRequest,
            clientId,
            unapprovedRedirectUrl,
            onAuthSuccess,
            response
          );
        }
      }
    }

    return isApiRequest
      ? unauthorizedJson()
      : redirectToLogin(request, loginRedirectUrl);
  };
}

async function handleVerifiedClaims(
  claims: AccessTokenClaims,
  request: NextRequest,
  isApiRequest: boolean,
  clientId: string | undefined,
  unapprovedRedirectUrl: LoginRedirectUrl | undefined,
  onAuthSuccess: AuthProxyOptions["onAuthSuccess"],
  response: NextResponse
): Promise<NextResponse> {
  if (!isApprovedClient(claims.approved_clients, clientId)) {
    return isApiRequest
      ? forbiddenJson()
      : redirectToUnapproved(request, unapprovedRedirectUrl);
  }

  return onAuthSuccess
    ? await onAuthSuccess(claims, request, response)
    : response;
}

function unauthorizedJson(): NextResponse {
  return NextResponse.json(
    { code: PROXY_AUTH_ERROR.UNAUTHORIZED },
    { status: 401 }
  );
}

function forbiddenJson(): NextResponse {
  return NextResponse.json(
    { code: PROXY_AUTH_ERROR.FORBIDDEN },
    { status: 403 }
  );
}

async function maybeRefreshAndContinue(
  request: NextRequest
): Promise<NextResponse> {
  const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
  const deviceId = request.cookies.get(DEVICE_ID_COOKIE)?.value;

  if (accessToken && isTokenFresh(accessToken)) {
    return NextResponse.next();
  }

  if (refreshToken) {
    const result = await tryRefresh(refreshToken, deviceId);
    if (result) {
      return nextWithRefreshedCookies(request, result.setCookieHeaders);
    }
  }

  return NextResponse.next();
}

/**
 * 갱신된 토큰을 이 요청의 cookie 헤더에도 반영한 응답을 만든다.
 *
 * Set-Cookie 는 브라우저에만 적용된다. 그것만 붙이면 지금 이 요청을 처리하는
 * 서버 컴포넌트는 여전히 만료된 access token 을 읽고, 갱신에 성공했는데도
 * 그 요청은 로그아웃으로 판정된다. access token 이 만료된 뒤 첫 요청마다
 * 발생하며, PWA 콜드 스타트처럼 항상 만료 상태에서 시작하는 경우 매번 겪는다.
 *
 * Next.js 는 미들웨어가 넘긴 요청 헤더를 다운스트림에 그대로 전달하므로
 * cookie 헤더를 새 토큰으로 바꿔 끼워 같은 요청에서 인증이 보이게 한다.
 * (response.headers.append 는 NextResponse 의 쿠키 프록시를 우회하기 때문에
 *  Next 의 x-middleware-set-cookie 병합 경로도 타지 않는다)
 */
function nextWithRefreshedCookies(
  request: NextRequest,
  setCookieHeaders: string[]
): NextResponse {
  const merged = new Map<string, string>();
  for (const { name, value } of request.cookies.getAll()) {
    merged.set(name, value);
  }

  // auth 서버는 도메인마다 같은 쿠키를 한 번씩 보내므로 이름 기준으로 덮어쓴다.
  for (const header of setCookieHeaders) {
    const pair = header.split(";")[0] ?? "";
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    merged.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(
    "cookie",
    Array.from(merged, ([name, value]) => `${name}=${value}`).join("; ")
  );

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const header of setCookieHeaders) {
    response.headers.append("Set-Cookie", header);
  }
  return response;
}

function isTokenFresh(token: string): boolean {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString()
    );
    return (
      typeof payload.exp === "number" &&
      payload.exp > Math.floor(Date.now() / 1000) + REFRESH_BUFFER_SECONDS
    );
  } catch {
    return false;
  }
}

async function verifyToken(
  token: string
): Promise<AccessTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: AUTH_SERVER_URL,
    });
    return isAccessTokenClaims(payload) ? payload : null;
  } catch {
    return null;
  }
}

interface RefreshSuccess {
  newAccessToken: string;
  setCookieHeaders: string[];
}

async function tryRefresh(
  refreshToken: string,
  deviceId?: string
): Promise<RefreshSuccess | null> {
  try {
    const res = await fetch(REFRESH_URL, {
      method: "POST",
      headers: { Cookie: buildRefreshCookieHeader(refreshToken, deviceId) },
    });

    if (!res.ok) return null;

    const setCookieHeaders = res.headers.getSetCookie();
    const newAccessToken = extractAccessToken(setCookieHeaders);
    if (!newAccessToken) return null;

    return { newAccessToken, setCookieHeaders };
  } catch {
    return null;
  }
}

function buildRefreshCookieHeader(
  refreshToken: string,
  deviceId?: string
): string {
  const cookies = [`${REFRESH_TOKEN_COOKIE}=${refreshToken}`];
  if (deviceId) {
    cookies.push(`${DEVICE_ID_COOKIE}=${deviceId}`);
  }
  return cookies.join("; ");
}

function extractAccessToken(setCookieHeaders: string[]): string | null {
  for (const header of setCookieHeaders) {
    const match = header.match(new RegExp(`^${ACCESS_TOKEN_COOKIE}=([^;]+)`));
    if (match) return match[1];
  }
  return null;
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
  loginRedirectUrl?: LoginRedirectUrl
): NextResponse {
  const redirectUrl = resolveLoginRedirectUrl(request, loginRedirectUrl);
  if (redirectUrl) {
    const url = `${LOGIN_URL}?redirect_url=${encodeURIComponent(redirectUrl)}`;
    return NextResponse.redirect(new URL(url, request.url));
  }
  return NextResponse.redirect(new URL("/", request.url));
}

function redirectToUnapproved(
  request: NextRequest,
  unapprovedRedirectUrl?: LoginRedirectUrl
): NextResponse {
  const redirectUrl = resolveLoginRedirectUrl(request, unapprovedRedirectUrl);
  if (redirectUrl) {
    return NextResponse.redirect(new URL(redirectUrl, request.url));
  }
  const errorUrl = new URL(`${AUTH_SERVER_URL}/error`);
  errorUrl.searchParams.set("code", PROXY_AUTH_ERROR.FORBIDDEN);
  errorUrl.searchParams.set("from", request.url);
  return NextResponse.redirect(errorUrl);
}

function resolveLoginRedirectUrl(
  request: NextRequest,
  loginRedirectUrl?: LoginRedirectUrl
): string | undefined {
  if (typeof loginRedirectUrl === "function") {
    return loginRedirectUrl(request);
  }
  return loginRedirectUrl;
}

export type { AccessTokenClaims } from "../types.js";
export type { LemonUser } from "../types.js";
