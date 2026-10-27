import type { JWTPayload } from "jose";
import type { AccessTokenClaims, LemonUser } from "./types.js";

export function isAccessTokenClaims(
  payload: JWTPayload
): payload is AccessTokenClaims {
  return (
    typeof payload.sub === "string" &&
    Array.isArray(payload.aud) &&
    payload.aud.every((audience) => typeof audience === "string") &&
    typeof payload.client_id === "string" &&
    typeof payload.nickname === "string" &&
    typeof payload.profile_image_url === "string" &&
    (payload.role === "user" || payload.role === "admin")
  );
}

export function isLemonUser(value: unknown): value is LemonUser {
  if (typeof value !== "object" || value === null) return false;
  const user = value as Record<string, unknown>;
  return (
    typeof user.uid === "string" &&
    typeof user.nickname === "string" &&
    typeof user.profileImageUrl === "string" &&
    (user.role === "user" || user.role === "admin") &&
    Array.isArray(user.approvedClients) &&
    user.approvedClients.every((clientId) => typeof clientId === "string")
  );
}
