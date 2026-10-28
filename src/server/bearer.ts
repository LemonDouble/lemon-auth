import { jwtVerify } from "jose";
import { isStringArray } from "../claims.js";
import { clientId, issuerUrl } from "../config.js";
import { errorCode, warnAuth } from "../log.js";
import type { BearerToken } from "../types.js";
import { getJwks } from "./jwks.js";

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
      // 사용자가 없는 토큰은 sub 가 client_id 다 (RFC 9068 §2.2). auth 서버가 client_id 를 정하므로 사용자 sub 와 겹치지 않는다.
      kind: payload.sub === payload.client_id ? "service" : "user",
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
