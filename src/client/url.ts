import {
  LOGIN_URL,
  LOGOUT_URL,
  PROFILE_PAGE_URL,
  REFRESH_URL,
} from "../constants.js";
import { isMockAuthEnabled } from "../mock.js";

export function loginUrl(redirectUrl: string): string {
  if (isMockAuthEnabled()) return redirectUrl;
  assertValidLoginRedirectUrl(redirectUrl);
  return `${LOGIN_URL}?redirect_url=${encodeURIComponent(redirectUrl)}`;
}

export function profileUrl(redirectUrl?: string): string {
  if (isMockAuthEnabled()) return redirectUrl ?? "/";
  if (redirectUrl) {
    return `${PROFILE_PAGE_URL}?redirect_url=${encodeURIComponent(redirectUrl)}`;
  }
  return PROFILE_PAGE_URL;
}

/** 쿠키는 httpOnly 라 삭제는 응답의 Set-Cookie 가 한다. */
export async function logout(): Promise<boolean> {
  if (isMockAuthEnabled()) return true;

  try {
    const res = await fetch(LOGOUT_URL, {
      method: "POST",
      credentials: "include",
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function refreshToken(): Promise<boolean> {
  if (isMockAuthEnabled()) return true;

  try {
    const res = await fetch(REFRESH_URL, {
      method: "POST",
      credentials: "include",
    });
    return res.ok;
  } catch {
    return false;
  }
}

function assertValidLoginRedirectUrl(redirectUrl: string): void {
  let url: URL;
  try {
    url = new URL(redirectUrl);
  } catch {
    throw new Error("loginUrl redirectUrl must be a valid absolute URL");
  }

  if (url.protocol !== "https:") {
    throw new Error("loginUrl redirectUrl must use https");
  }

  if (!isAllowedLoginRedirectHost(url.hostname)) {
    throw new Error(
      "loginUrl redirectUrl host must be lemondouble.com or a subdomain of lemondouble.com"
    );
  }
}

function isAllowedLoginRedirectHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "lemondouble.com" ||
    normalized.endsWith(".lemondouble.com")
  );
}
