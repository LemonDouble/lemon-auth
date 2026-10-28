import * as client from "openid-client";
import { decodeJwt } from "jose";
import { userFromIdTokenClaims } from "./claims.js";
import { getOidcConfiguration, keepsAccessToken } from "./config.js";
import { errorCode, warnAuth } from "./log.js";
import { sealCookieValue, unsealCookieValue } from "./sealed-cookie.js";
import type { AccessToken, LemonUser } from "./types.js";

/** OP 세션과 refresh token 의 수명(마지막 사용 후 30일)에 맞춘다. 갱신할 때마다 다시 쓴다. */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** 만료 직전에 갱신해, 갱신한 요청 안에서 토큰이 만료되지 않게 한다. */
const REFRESH_BEFORE_EXPIRY_SECONDS = 60;

/** 쿠키에는 서버가 쓸 값만 담는다. 사용자 정보는 ID Token 에서 읽는다. */
export interface StoredSession {
  refreshToken: string;
  /** 로그아웃할 때 id_token_hint 로 보낸다. 받을 때 openid-client 가 검증했다. */
  idToken: string;
  accessTokenExpiresAt: number;
  /** LEMON_AUTH_KEEP_ACCESS_TOKEN 을 켠 앱만 담는다. */
  accessToken?: string;
}

export function sealSession(session: StoredSession): Promise<string> {
  return sealCookieValue({ ...session }, SESSION_MAX_AGE_SECONDS);
}

export async function unsealSession(value: string | undefined): Promise<StoredSession | null> {
  const payload = await unsealCookieValue(value);
  if (
    typeof payload?.refreshToken !== "string" ||
    typeof payload.idToken !== "string" ||
    typeof payload.accessTokenExpiresAt !== "number"
  ) {
    return null;
  }
  return {
    refreshToken: payload.refreshToken,
    idToken: payload.idToken,
    accessTokenExpiresAt: payload.accessTokenExpiresAt,
    accessToken: typeof payload.accessToken === "string" ? payload.accessToken : undefined,
  };
}

/** confidential client 라 refresh 응답에는 보통 refresh token 이 없다. 그때는 쓰던 값을 그대로 둔다. */
export function sessionFromTokens(
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
  previous?: StoredSession
): StoredSession {
  const refreshToken = tokens.refresh_token ?? previous?.refreshToken;
  const idToken = tokens.id_token ?? previous?.idToken;
  if (!refreshToken || !idToken) {
    throw new Error("[lemon-auth] token response has no refresh_token or id_token");
  }
  return {
    refreshToken,
    idToken,
    accessTokenExpiresAt: nowSeconds() + (tokens.expiresIn() ?? 0),
    accessToken: keepsAccessToken() ? tokens.access_token : undefined,
  };
}

export function userFromSession(session: StoredSession): LemonUser {
  return userFromIdTokenClaims(decodeJwt(session.idToken));
}

export function accessTokenFromSession(session: StoredSession): AccessToken | null {
  if (!session.accessToken) return null;
  return { value: session.accessToken, expiresAt: session.accessTokenExpiresAt };
}

/** access token 이 만료된 세션은 갱신하기 전까지 로그인 상태로 보지 않는다. 로그아웃이나 기기 해제는 갱신할 때 반영된다. */
export function isExpired(session: StoredSession): boolean {
  return session.accessTokenExpiresAt <= nowSeconds();
}

export function needsRefresh(session: StoredSession): boolean {
  return session.accessTokenExpiresAt - REFRESH_BEFORE_EXPIRY_SECONDS <= nowSeconds();
}

export type RefreshResult =
  | { type: "refreshed"; session: StoredSession }
  /** OP 가 갱신을 거절했다 (로그아웃, 기기 해제, 잠금, 승인 취소). 세션을 지운다. */
  | { type: "ended" }
  /** auth 서버에 닿지 못했다. 세션은 두고, 만료 전이면 그대로 쓴다. */
  | { type: "unavailable" };

export async function refreshSession(session: StoredSession): Promise<RefreshResult> {
  try {
    const configuration = await getOidcConfiguration();
    const tokens = await client.refreshTokenGrant(configuration, session.refreshToken);
    return { type: "refreshed", session: sessionFromTokens(tokens, session) };
  } catch (error) {
    if (error instanceof client.ResponseBodyError && error.status < 500) {
      if (error.error !== "invalid_grant") {
        warnAuth("token refresh rejected", { error: error.error });
      }
      return { type: "ended" };
    }
    warnAuth("token refresh failed", { code: errorCode(error) });
    return { type: "unavailable" };
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
