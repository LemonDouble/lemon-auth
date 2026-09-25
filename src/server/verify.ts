import { createRemoteJWKSet, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { AccessTokenClaims } from "../types.js";
import { JWKS_URL, AUTH_SERVER_URL, ACCESS_TOKEN_COOKIE } from "../constants.js";
import { isAccessTokenClaims } from "../claims.js";
import { getMockAccessTokenClaims } from "../mock.js";
import { warnAuth, errorCode } from "../log.js";

const jwks = createRemoteJWKSet(new URL(JWKS_URL));

export async function verifyAccessToken(): Promise<AccessTokenClaims | null> {
  const mockClaims = getMockAccessTokenClaims();
  if (mockClaims) return mockClaims;

  const cookieStore = await cookies();
  const token = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: AUTH_SERVER_URL,
      // 발급자(자택 k3s)와 검증자(Vercel)의 시계 어긋남 허용
      clockTolerance: 10,
    });
    if (isAccessTokenClaims(payload)) return payload;
    warnAuth("access token claims shape mismatch");
    return null;
  } catch (error) {
    // 정상 만료는 흔한 경로라 남기지 않는다. 키 로테이션·JWKS 장애와 위조를 구분하려고 code 를 남긴다.
    const code = errorCode(error);
    if (code !== "ERR_JWT_EXPIRED") {
      warnAuth("access token verification failed", { code });
    }
    return null;
  }
}
