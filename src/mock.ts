import { isLemonUser } from "./claims.js";
import type { LemonUser } from "./types.js";

const LEMON_AUTH_MOCK_USER_ENV = "NEXT_PUBLIC_LEMON_AUTH_MOCK_USER";

export function isMockAuthEnabled(): boolean {
  return readMockUserEnv() !== undefined;
}

export function getMockUser(): LemonUser | null {
  const raw = readMockUserEnv();
  if (raw === undefined) return null;

  const user = parseJson(raw);
  if (!isLemonUser(user)) {
    throw new Error(
      `${LEMON_AUTH_MOCK_USER_ENV} must be a JSON object with every LemonUser field`
    );
  }
  return user;
}

/** production 에서는 무시한다. 번들러가 process.env 를 치환하지 않으면 process 가 없을 수 있다. */
function readMockUserEnv(): string | undefined {
  try {
    if (process.env.NODE_ENV === "production") return undefined;
    return process.env.NEXT_PUBLIC_LEMON_AUTH_MOCK_USER || undefined;
  } catch {
    return undefined;
  }
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
