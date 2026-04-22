import { NextRequest, NextResponse } from "next/server";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  AUTH_SERVER_URL,
  REFRESH_URL,
  JWKS_URL,
  LOGIN_URL,
} from "../constants.js";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AccessTokenClaims } from "../types.js";

const REFRESH_BUFFER_SECONDS = 60;

const jwks = createRemoteJWKSet(new URL(JWKS_URL));

export interface AuthProxyOptions {
  publicPaths?: string[];
  clientId?: string;
  loginRedirectUrl?: string;
  onAuthSuccess?: (
    claims: AccessTokenClaims,
    request: NextRequest,
    response: NextResponse
  ) => Promise<NextResponse> | NextResponse;
}

export function createAuthProxy(options: AuthProxyOptions = {}) {
  const { publicPaths = [], clientId, loginRedirectUrl, onAuthSuccess } =
    options;

  return async function proxy(request: NextRequest): Promise<NextResponse> {
    const { pathname } = request.nextUrl;

    if (isPublicPath(pathname, publicPaths)) {
      return maybeRefreshAndContinue(request);
    }

    const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
    const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;

    if (accessToken && isTokenFresh(accessToken)) {
      const claims = await verifyToken(accessToken);
      if (claims) {
        if (clientId && !claims.approved_clients.includes(clientId)) {
          return redirectToLogin(request, loginRedirectUrl);
        }
        const response = NextResponse.next();
        return onAuthSuccess
          ? await onAuthSuccess(claims, request, response)
          : response;
      }
    }

    if (refreshToken) {
      const result = await tryRefresh(refreshToken);
      if (result) {
        const claims = await verifyToken(result.newAccessToken);
        if (claims) {
          if (clientId && !claims.approved_clients.includes(clientId)) {
            return redirectToLogin(request, loginRedirectUrl);
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

    return redirectToLogin(request, loginRedirectUrl);
  };
}

async function maybeRefreshAndContinue(
  request: NextRequest
): Promise<NextResponse> {
  const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;

  if (accessToken && isTokenFresh(accessToken)) {
    return NextResponse.next();
  }

  if (refreshToken) {
    const result = await tryRefresh(refreshToken);
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
    return payload as unknown as AccessTokenClaims;
  } catch {
    return null;
  }
}

interface RefreshSuccess {
  newAccessToken: string;
  setCookieHeaders: string[];
}

async function tryRefresh(
  refreshToken: string
): Promise<RefreshSuccess | null> {
  try {
    const res = await fetch(REFRESH_URL, {
      method: "POST",
      headers: { Cookie: `refresh_token=${refreshToken}` },
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

function extractAccessToken(setCookieHeaders: string[]): string | null {
  for (const header of setCookieHeaders) {
    const match = header.match(/^access_token=([^;]+)/);
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
  loginRedirectUrl?: string
): NextResponse {
  if (loginRedirectUrl) {
    const url = `${LOGIN_URL}?redirect_url=${encodeURIComponent(loginRedirectUrl)}`;
    return NextResponse.redirect(new URL(url, request.url));
  }
  return NextResponse.redirect(new URL("/", request.url));
}

export type { AccessTokenClaims } from "../types.js";
export type { LemonUser } from "../types.js";
