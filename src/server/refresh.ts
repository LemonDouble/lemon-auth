import { REFRESH_URL } from "../constants.js";

export interface RefreshResult {
  ok: boolean;
  setCookieHeaders: string[];
}

export async function refreshTokenFromCookie(
  refreshTokenCookie: string
): Promise<RefreshResult> {
  const res = await fetch(REFRESH_URL, {
    method: "POST",
    headers: {
      Cookie: `lemon_refresh_token=${refreshTokenCookie}`,
    },
  });

  if (!res.ok) {
    return { ok: false, setCookieHeaders: [] };
  }

  const setCookieHeaders = res.headers.getSetCookie();
  return { ok: true, setCookieHeaders };
}
