import { createRemoteJWKSet, type JWTVerifyGetKey } from "jose";
import { getOidcConfiguration } from "../config.js";

// 키는 거의 바뀌지 않는다. 새 kid 는 캐시와 관계없이 다시 받는다.
const JWKS_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

let jwks: Promise<JWTVerifyGetKey> | undefined;

export function getJwks(): Promise<JWTVerifyGetKey> {
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
