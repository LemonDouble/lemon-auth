import {
  DEVICE_ID_COOKIE,
  REFRESH_TOKEN_COOKIE,
  REFRESH_URL,
} from "../constants.js";
import { isMockAuthEnabled } from "../mock.js";
import { warnAuth } from "../log.js";

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
    // proxy 의 tryRefresh 와 같은 이유로 남긴다. 이 요청도 서버에서 나가므로
    // auth 서버 앞의 WAF · 봇 방어에 걸리면 origin 에 흔적이 남지 않는다.
    // (이 함수는 proxy 와 달리 네트워크 예외를 잡지 않고 호출자에게 던진다)
    warnAuth("token refresh rejected", {
      status: res.status,
      server: res.headers.get("server"),
      cfRay: res.headers.get("cf-ray"),
      cfMitigated: res.headers.get("cf-mitigated"),
    });
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
