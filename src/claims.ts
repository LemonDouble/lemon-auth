import type { JWTPayload } from "jose";
import type { LemonUser } from "./types.js";

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** 앱이 요청하는 scope 는 openid profile email 이라 name, updated_at 은 항상 온다. */
export function userFromIdTokenClaims(claims: JWTPayload): LemonUser {
  const groups = isStringArray(claims.groups) ? claims.groups : [];
  return {
    sub: claims.sub ?? "",
    name: typeof claims.name === "string" ? claims.name : "",
    picture: typeof claims.picture === "string" ? claims.picture : null,
    email: typeof claims.email === "string" ? claims.email : null,
    groups,
    isAdmin: groups.includes("admin"),
    updatedAt: typeof claims.updated_at === "number" ? claims.updated_at : 0,
  };
}
