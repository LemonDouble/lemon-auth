import type { AccessTokenClaims, LemonUser } from "./types.js";

export const LEMON_AUTH_MOCK_USER_ENV =
  "NEXT_PUBLIC_LEMON_AUTH_MOCK_USER";

export function isMockAuthEnabled(): boolean {
  return !isProduction() && Boolean(readMockUserEnv());
}

export function getMockUser(): LemonUser | null {
  const raw = readMockUserEnv();
  if (isProduction() || !raw) return null;
  return parseMockUser(raw);
}

export function getMockAccessTokenClaims(): AccessTokenClaims | null {
  const user = getMockUser();
  if (!user) return null;

  const now = Math.floor(Date.now() / 1000);
  return {
    token_type: "access",
    sub: user.uid,
    nickname: user.nickname,
    profile_image_url: user.profileImageUrl,
    role: user.role,
    approved_clients: user.approvedClients,
    iss: "lemon-auth-mock",
    iat: now,
    exp: now + 60 * 60 * 24 * 365,
  };
}

function readMockUserEnv(): string | undefined {
  try {
    return process.env.NEXT_PUBLIC_LEMON_AUTH_MOCK_USER;
  } catch {
    return undefined;
  }
}

function isProduction(): boolean {
  try {
    return process.env.NODE_ENV === "production";
  } catch {
    return false;
  }
}

function parseMockUser(raw: string): LemonUser {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      `${LEMON_AUTH_MOCK_USER_ENV} must be a valid JSON object`
    );
  }

  if (!isRecord(data)) {
    throw new Error(`${LEMON_AUTH_MOCK_USER_ENV} must be a JSON object`);
  }

  return {
    uid: readOptionalString(data.uid, "local-user", "uid"),
    nickname: readOptionalString(data.nickname, "Local User", "nickname"),
    profileImageUrl: readOptionalString(
      data.profileImageUrl ?? data.profile_image_url,
      "",
      "profileImageUrl"
    ),
    role: readOptionalRole(data.role, "admin"),
    approvedClients: readOptionalStringArray(
      data.approvedClients ?? data.approved_clients,
      ["*"],
      "approvedClients"
    ),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionalString(
  value: unknown,
  fallback: string,
  field: string
): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string") return value;
  throw new Error(`${LEMON_AUTH_MOCK_USER_ENV}.${field} must be a string`);
}

function readOptionalRole(
  value: unknown,
  fallback: LemonUser["role"]
): LemonUser["role"] {
  if (value === undefined || value === null) return fallback;
  if (value === "user" || value === "admin") return value;
  throw new Error(
    `${LEMON_AUTH_MOCK_USER_ENV}.role must be "user" or "admin"`
  );
}

function readOptionalStringArray(
  value: unknown,
  fallback: string[],
  field: string
): string[] {
  if (value === undefined || value === null) return fallback;
  if (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string")
  ) {
    return value;
  }
  throw new Error(
    `${LEMON_AUTH_MOCK_USER_ENV}.${field} must be a string array`
  );
}
