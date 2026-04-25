import {
  DEVICE_ID_COOKIE,
  REFRESH_TOKEN_COOKIE,
  REFRESH_URL,
} from "../constants.js";
import { isMockAuthEnabled } from "../mock.js";

export interface RefreshResult {
  ok: boolean;
  setCookieHeaders: string[];
}

export async function refreshTokenFromCookie(
  refreshTokenCookie: string,
  deviceIdCookie?: string
): Promise<RefreshResult> {
  if (isMockAuthEnabled()) {
    return { ok: true, setCookieHeaders: [] };
  }

  const res = await fetch(REFRESH_URL, {
    method: "POST",
    headers: {
      Cookie: buildRefreshCookieHeader(refreshTokenCookie, deviceIdCookie),
    },
  });

  if (!res.ok) {
    return { ok: false, setCookieHeaders: [] };
  }

  const setCookieHeaders = res.headers.getSetCookie();
  return { ok: true, setCookieHeaders };
}

function buildRefreshCookieHeader(
  refreshTokenCookie: string,
  deviceIdCookie?: string
): string {
  const cookies = [`${REFRESH_TOKEN_COOKIE}=${refreshTokenCookie}`];
  if (deviceIdCookie) {
    cookies.push(`${DEVICE_ID_COOKIE}=${deviceIdCookie}`);
  }
  return cookies.join("; ");
}
