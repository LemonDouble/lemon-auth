import { isStringArray } from "./claims.js";
import type { LemonUser } from "./types.js";

const MOCK_ENV = "LEMON_AUTH_MOCK";

/** 로컬 개발에서 auth 서버 없이 가짜 사용자로 동작한다. production 빌드에서는 무시한다. */
export function isMockAuthEnabled(): boolean {
  return readMockEnv() !== undefined;
}

export function getMockUser(): LemonUser | null {
  const raw = readMockEnv();
  if (raw === undefined) return null;

  const value = parseJson(raw);
  if (typeof value !== "object" || value === null) {
    throw new Error(`[lemon-auth] ${MOCK_ENV} must be a JSON object`);
  }
  const fields = value as Record<string, unknown>;
  if (typeof fields.sub !== "string" || typeof fields.name !== "string") {
    throw new Error(`[lemon-auth] ${MOCK_ENV} needs string "sub" and "name"`);
  }
  const groups = isStringArray(fields.groups) ? fields.groups : [];
  return {
    sub: fields.sub,
    name: fields.name,
    picture: typeof fields.picture === "string" ? fields.picture : null,
    email: typeof fields.email === "string" ? fields.email : null,
    groups,
    isAdmin: groups.includes("admin"),
    updatedAt: typeof fields.updatedAt === "number" ? fields.updatedAt : 0,
  };
}

function readMockEnv(): string | undefined {
  if (process.env.NODE_ENV === "production") return undefined;
  return process.env[MOCK_ENV] || undefined;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
