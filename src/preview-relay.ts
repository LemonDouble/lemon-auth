import { SignJWT, jwtVerify } from "jose";
import { randomState } from "openid-client";
import { previewOriginPattern } from "./config.js";
import { getDerivedKeys } from "./secret.js";

/**
 * preview 배포는 redirect URI 로 등록할 수 없어서, 운영 배포의 콜백이 code 를 preview 로 넘긴다.
 * state 에 preview origin 을 서명해 담고, 운영 콜백은 서명과 허용 패턴을 모두 확인한 뒤에만 넘긴다.
 */

const RELAY_STATE_TYPE = "lemon-auth-relay+jwt";
const RELAY_STATE_LIFETIME = "10m";

export async function signRelayState(previewOrigin: string): Promise<string> {
  const { relayState } = await getDerivedKeys();
  return new SignJWT({ origin: previewOrigin })
    .setProtectedHeader({ alg: "HS256", typ: RELAY_STATE_TYPE })
    .setJti(randomState())
    .setIssuedAt()
    .setExpirationTime(RELAY_STATE_LIFETIME)
    .sign(relayState);
}

/** 운영 콜백이 넘겨도 되는 preview origin. 중계 state 가 아니거나 허용하지 않은 곳이면 null. */
export async function relayTargetOf(state: string | null): Promise<string | null> {
  if (!state) return null;
  const { relayState } = await getDerivedKeys();
  try {
    const { payload } = await jwtVerify(state, relayState, {
      algorithms: ["HS256"],
      typ: RELAY_STATE_TYPE,
    });
    const origin = payload.origin;
    if (typeof origin !== "string" || !isAllowedPreviewOrigin(origin, previewOriginPattern())) {
      return null;
    }
    return origin;
  } catch {
    return null;
  }
}

/** `*` 는 영문 소문자, 숫자, `-` 로 된 한 부분만 맞는다. 점이나 `/` 가 들어간 주소는 맞지 않는다. */
export function isAllowedPreviewOrigin(origin: string, pattern: string | undefined): boolean {
  if (!pattern?.startsWith("https://")) return false;
  const expression = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[a-z0-9-]+");
  return new RegExp(`^${expression}$`).test(origin);
}
