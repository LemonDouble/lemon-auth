import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { isStringArray } from "../claims.js";
import { clientId, getOidcConfiguration, issuerUrl } from "../config.js";
import { errorCode, warnAuth } from "../log.js";
import type { BearerToken } from "../types.js";

// 키는 거의 바뀌지 않는다. 새 kid 는 캐시와 관계없이 다시 받는다.
const JWKS_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

let jwks: Promise<JWTVerifyGetKey> | undefined;

function getJwks(): Promise<JWTVerifyGetKey> {
  jwks ??= getOidcConfiguration()
    .then((configuration) => {
      const jwksUri = configuration.serverMetadata().jwks_uri;
      if (!jwksUri) throw new Error("[lemon-auth] discovery document has no jwks_uri");
      return createRemoteJWKSet(new URL(jwksUri), { cacheMaxAge: JWKS_CACHE_MAX_AGE_MS });
    })
    .catch((error: unknown) => {
      jwks = undefined;
      throw error;
    });
  return jwks;
}

/**
 * `Authorization: Bearer` access token 을 RFC 9068 규칙으로 검증한다.
 * aud 에 이 앱의 client_id 가 있어야 하므로, 다른 앱에 발급한 토큰은 통과하지 못한다.
 */
export async function verifyBearerToken(request: Request): Promise<BearerToken | null> {
  const token = readBearerToken(request.headers.get("authorization"));
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, await getJwks(), {
      issuer: issuerUrl(),
      audience: clientId(),
      typ: "at+jwt",
      algorithms: ["RS256"],
      requiredClaims: ["exp", "sub"],
      // 발급자(자택 k3s)와 검증자(Vercel)의 시계 어긋남 허용
      clockTolerance: 10,
    });
    if (typeof payload.sub !== "string" || typeof payload.client_id !== "string") {
      warnAuth("bearer token claims shape mismatch");
      return null;
    }
    const groups = isStringArray(payload.groups) ? payload.groups : [];
    return {
      sub: payload.sub,
      clientId: payload.client_id,
      scope: typeof payload.scope === "string" ? payload.scope.split(" ").filter(Boolean) : [],
      groups,
      isAdmin: groups.includes("admin"),
    };
  } catch (error) {
    // 정상 만료는 흔한 경로라 남기지 않는다. 키 교체, JWKS 장애, 위조를 구분하려고 code 를 남긴다.
    const code = errorCode(error);
    if (code !== "ERR_JWT_EXPIRED") warnAuth("bearer token verification failed", { code });
    return null;
  }
}

function readBearerToken(authorization: string | null): string | undefined {
  return authorization?.match(/^Bearer ([A-Za-z0-9\-._~+/]+=*)$/i)?.[1];
}
