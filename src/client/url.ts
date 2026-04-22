import {
  LOGIN_URL,
  LOGOUT_URL,
  PROFILE_PAGE_URL,
  REFRESH_URL,
} from "../constants.js";

export function loginUrl(redirectUrl: string): string {
  return `${LOGIN_URL}?redirect_url=${encodeURIComponent(redirectUrl)}`;
}

export function profileUrl(redirectUrl?: string): string {
  if (redirectUrl) {
    return `${PROFILE_PAGE_URL}?redirect_url=${encodeURIComponent(redirectUrl)}`;
  }
  return PROFILE_PAGE_URL;
}

export async function logout(): Promise<void> {
  await fetch(LOGOUT_URL, {
    method: "POST",
    credentials: "include",
  });
}

export async function refreshToken(): Promise<boolean> {
  const res = await fetch(REFRESH_URL, {
    method: "POST",
    credentials: "include",
  });
  return res.ok;
}
