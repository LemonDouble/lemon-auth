import { createRemoteJWKSet, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { AccessTokenClaims } from "../types.js";
import { JWKS_URL, AUTH_SERVER_URL, ACCESS_TOKEN_COOKIE } from "../constants.js";
import { isAccessTokenClaims } from "../claims.js";
import { getMockAccessTokenClaims } from "../mock.js";
import { warnAuth, errorCode } from "../log.js";

const jwks = createRemoteJWKSet(new URL(JWKS_URL));

/**
 * 검증과 진단을 한 곳에 모은다.
 *
 * 예전에는 아래 두 export 가 같은 try/catch 를 각자 갖고 있었다. 그러면
 * 로깅을 붙일 때도 벌마다 갈리고, 한쪽만 고치는 일이 생긴다.
 */
async function verify(token: string): Promise<AccessTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: AUTH_SERVER_URL,
      // 발급자(자택 k3s)와 검증자(Vercel)의 시계가 몇 초 어긋나면, 방금
      // 발급된 토큰이 nbf 미래로 거부되어 로그인 직후 로그아웃으로 보인다.
      clockTolerance: 10,
    });
    if (isAccessTokenClaims(payload)) return payload;
    warnAuth("access token claims shape mismatch");
    return null;
  } catch (error) {
    // 정상 만료는 갱신으로 이어지는 흔한 경로라 남기지 않는다. 나머지는
    // 원인이 전혀 다르다 — 특히 ERR_JWKS_NO_MATCHING_KEY 는 키 로테이션이나
    // JWKS 도달 실패이고, 이걸 위조 토큰과 뭉개면 전 사용자가 조용히
    // 로그아웃된 이유를 알 수 없게 된다.
    const code = errorCode(error);
    if (code !== "ERR_JWT_EXPIRED") {
      warnAuth("access token verification failed", { code });
    }
    return null;
  }
}

export async function verifyAccessToken(): Promise<AccessTokenClaims | null> {
  const mockClaims = getMockAccessTokenClaims();
  if (mockClaims) return mockClaims;

  const cookieStore = await cookies();
  const token = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
  if (!token) return null;

  return verify(token);
}

export async function verifyAccessTokenString(
  token: string
): Promise<AccessTokenClaims | null> {
  const mockClaims = getMockAccessTokenClaims();
  if (mockClaims) return mockClaims;

  return verify(token);
}
