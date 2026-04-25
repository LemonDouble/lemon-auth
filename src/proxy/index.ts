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

    const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
    const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
    const deviceId = request.cookies.get(DEVICE_ID_COOKIE)?.value;

    if (accessToken && isTokenFresh(accessToken)) {
      const claims = await verifyToken(accessToken);
      if (claims) {
        if (clientId && !claims.approved_clients.includes(clientId)) {
          return isApiRequest
            ? forbiddenJson()
            : redirectToUnapproved(request, unapprovedRedirectUrl);
        }
        const response = NextResponse.next();
        return onAuthSuccess
          ? await onAuthSuccess(claims, request, response)
          : response;
      }
    }

    if (refreshToken) {
      const result = await tryRefresh(refreshToken, deviceId);
      if (result) {
        const claims = await verifyToken(result.newAccessToken);
        if (claims) {
          if (clientId && !claims.approved_clients.includes(clientId)) {
            return isApiRequest
              ? forbiddenJson()
              : redirectToUnapproved(request, unapprovedRedirectUrl);
          }
          const response = NextResponse.next();
          for (const header of result.setCookieHeaders) {
            response.headers.append("Set-Cookie", header);
          }
          return onAuthSuccess
            ? await onAuthSuccess(claims, request, response)
            : response;
        }
      }
    }

    return isApiRequest
      ? unauthorizedJson()
      : redirectToLogin(request, loginRedirectUrl);
  };
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
      const response = NextResponse.next();
      for (const header of result.setCookieHeaders) {
        response.headers.append("Set-Cookie", header);
      }
      return response;
    }
  }

  return NextResponse.next();
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
    const match = header.match(/^lemon_access_token=([^;]+)/);
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
