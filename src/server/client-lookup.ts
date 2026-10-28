import { clientId, issuerUrl, requiredEnv } from "../config.js";
import { errorCode, warnAuth } from "../log.js";
import type { ClientInfo } from "../types.js";

// 서비스 이름과 아이콘은 거의 바뀌지 않는다. 요청마다 auth 서버를 부르지 않게 잠시 기억한다.
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { info: ClientInfo | null; expiresAt: number }>();

/**
 * client_id 로 auth 서버에 등록된 서비스의 이름과 아이콘을 조회한다.
 * Bearer 토큰의 `clientId` 로 누가 불렀는지 확인할 때 쓴다. 이 앱의 client_id 와 secret 으로 인증한다.
 * 없는 client 면 null 이다. auth 서버에 닿지 못해도 null 이고, 이때는 기억하지 않아 다음에 다시 묻는다.
 */
export async function lookupClient(targetClientId: string): Promise<ClientInfo | null> {
  const cached = cache.get(targetClientId);
  if (cached && cached.expiresAt > Date.now()) return cached.info;

  try {
    const response = await fetch(`${issuerUrl()}/api/clients/${encodeURIComponent(targetClientId)}`, {
      headers: { authorization: basicAuthorization() },
    });
    if (response.status === 404) return remember(targetClientId, null);
    if (!response.ok) {
      warnAuth("client lookup failed", { status: response.status });
      return null;
    }
    const body = (await response.json()) as { client_id: string; name: string; icon_url: string };
    return remember(targetClientId, { clientId: body.client_id, name: body.name, iconUrl: body.icon_url });
  } catch (error) {
    warnAuth("client lookup failed", { code: errorCode(error) });
    return null;
  }
}

function remember(targetClientId: string, info: ClientInfo | null): ClientInfo | null {
  cache.set(targetClientId, { info, expiresAt: Date.now() + CACHE_TTL_MS });
  return info;
}

// id 와 secret 은 form-urlencoded 로 인코딩한 뒤 Basic 으로 보낸다 (RFC 6749 §2.3.1).
function basicAuthorization(): string {
  const encode = (value: string) => encodeURIComponent(value).replace(/%20/g, "+");
  return "Basic " + btoa(`${encode(clientId())}:${encode(requiredEnv("LEMON_AUTH_CLIENT_SECRET"))}`);
}

/** 테스트에서 기억한 값을 지운다. */
export function clearClientLookupCache(): void {
  cache.clear();
}
