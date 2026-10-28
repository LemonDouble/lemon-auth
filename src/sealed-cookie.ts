import { EncryptJWT, jwtDecrypt, type JWTPayload } from "jose";
import type { NextResponse } from "next/server";
import { getDerivedKeys } from "./secret.js";

const COOKIE_ATTRIBUTES = { httpOnly: true, secure: true, sameSite: "lax", path: "/" } as const;

export async function sealCookieValue(payload: JWTPayload, maxAgeSeconds: number): Promise<string> {
  const { cookie } = await getDerivedKeys();
  return new EncryptJWT(payload)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(`${maxAgeSeconds}s`)
    .encrypt(cookie);
}

/** 키가 바뀌었거나, 위조되었거나, 만료된 값은 없는 것으로 본다. */
export async function unsealCookieValue(value: string | undefined): Promise<JWTPayload | null> {
  if (!value) return null;
  const { cookie } = await getDerivedKeys();
  try {
    const { payload } = await jwtDecrypt(value, cookie, {
      keyManagementAlgorithms: ["dir"],
      contentEncryptionAlgorithms: ["A256GCM"],
    });
    return payload;
  } catch {
    return null;
  }
}

export function setCookie(response: NextResponse, name: string, value: string, maxAgeSeconds: number): void {
  response.cookies.set(name, value, { ...COOKIE_ATTRIBUTES, maxAge: maxAgeSeconds });
}

/** `__Host-` 쿠키는 지울 때도 Secure 와 Path=/ 가 있어야 브라우저가 받아들인다. */
export function deleteCookie(response: NextResponse, name: string): void {
  response.cookies.set(name, "", { ...COOKIE_ATTRIBUTES, maxAge: 0 });
}
