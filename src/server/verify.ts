import { createRemoteJWKSet, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { AccessTokenClaims } from "../types.js";
import { JWKS_URL, AUTH_SERVER_URL, ACCESS_TOKEN_COOKIE } from "../constants.js";
import { isAccessTokenClaims } from "../claims.js";

const jwks = createRemoteJWKSet(new URL(JWKS_URL));

export async function verifyAccessToken(): Promise<AccessTokenClaims | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: AUTH_SERVER_URL,
    });
    return isAccessTokenClaims(payload) ? payload : null;
  } catch {
    return null;
  }
}

export async function verifyAccessTokenString(
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
