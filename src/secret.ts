import { requiredEnv } from "./config.js";

const SECRET_ENV = "LEMON_AUTH_SECRET";

export interface DerivedKeys {
  /** 세션과 로그인 임시 쿠키의 암호화 (JWE dir, A256GCM) */
  cookie: Uint8Array;
  /** preview 중계용 state 의 서명 (HS256) */
  relayState: Uint8Array;
}

let derivedKeys: { secret: string; keys: Promise<DerivedKeys> } | undefined;

/** 한 비밀값을 두 알고리즘에 그대로 쓰지 않도록 용도별 키를 HKDF 로 나눈다. */
export function getDerivedKeys(): Promise<DerivedKeys> {
  const secret = requiredEnv(SECRET_ENV);
  if (derivedKeys?.secret !== secret) {
    derivedKeys = { secret, keys: deriveKeys(decodeSecret(secret)) };
  }
  return derivedKeys.keys;
}

function decodeSecret(secret: string): Uint8Array {
  const bytes = Buffer.from(secret, "base64");
  if (bytes.length !== 32) {
    throw new Error(`[lemon-auth] ${SECRET_ENV} must be 32 random bytes in base64 (openssl rand -base64 32)`);
  }
  return new Uint8Array(bytes);
}

async function deriveKeys(secret: Uint8Array): Promise<DerivedKeys> {
  const baseKey = await crypto.subtle.importKey("raw", secret as BufferSource, "HKDF", false, ["deriveBits"]);
  const derive = async (purpose: string) =>
    new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: new TextEncoder().encode(purpose) },
        baseKey,
        256
      )
    );
  return {
    cookie: await derive("lemon-auth cookie"),
    relayState: await derive("lemon-auth relay state"),
  };
}
