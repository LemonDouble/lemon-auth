import {
  ACCESS_TOKEN_COOKIE,
  DEVICE_ID_COOKIE,
  LOGIN_URL,
  LOGOUT_URL,
  PROFILE_PAGE_URL,
  REFRESH_URL,
  REFRESH_TOKEN_COOKIE,
} from "../constants.js";
import { isMockAuthEnabled } from "../mock.js";

const LOGOUT_COOKIE_NAMES = [
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  DEVICE_ID_COOKIE,
];

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

export async function logout(): Promise<boolean> {
  if (isMockAuthEnabled()) {
    expireAuthCookies();
    return true;
  }

  try {
    const res = await fetch(LOGOUT_URL, {
      method: "POST",
      credentials: "include",
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    expireAuthCookies();
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

function expireAuthCookies(): void {
  if (typeof document === "undefined") return;

  for (const name of LOGOUT_COOKIE_NAMES) {
    for (const domain of getCookieDomains()) {
      document.cookie = [
        `${name}=`,
        "Max-Age=0",
        "Path=/",
        "SameSite=Lax",
        domain ? `Domain=${domain}` : "",
      ]
        .filter(Boolean)
        .join("; ");
    }
  }
}

function getCookieDomains(): string[] {
  if (typeof window === "undefined") return [""];

  const { hostname } = window.location;
  if (!hostname || hostname === "localhost" || isIpAddress(hostname)) {
    return [""];
  }

  const labels = hostname.split(".");
  const domains = [""];
  for (let i = 0; i < labels.length - 1; i += 1) {
    domains.push(`.${labels.slice(i).join(".")}`);
  }
  return domains;
}

function isIpAddress(hostname: string): boolean {
  return /^[\d.]+$/.test(hostname) || hostname.includes(":");
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
