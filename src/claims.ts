import type { JWTPayload } from "jose";
import type { AccessTokenClaims } from "./types.js";

export function isAccessTokenClaims(
  payload: JWTPayload
): payload is AccessTokenClaims {
  return (
    payload.token_type === "access" &&
    typeof payload.sub === "string" &&
    typeof payload.nickname === "string" &&
    typeof payload.profile_image_url === "string" &&
    (payload.role === "user" || payload.role === "admin") &&
    Array.isArray(payload.approved_clients) &&
    payload.approved_clients.every((clientId) => typeof clientId === "string")
  );
}
