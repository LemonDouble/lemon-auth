import { NextRequest } from "next/server";

export const APP_ORIGIN = "https://app.lemondouble.com";
export const PREVIEW_ORIGIN = "https://app-git-feature-x-lemondouble.vercel.app";

export function appRequest(
  path: string,
  { origin = APP_ORIGIN, method = "GET", cookies = {}, headers = {} }: {
    origin?: string;
    method?: string;
    cookies?: Record<string, string>;
    headers?: Record<string, string>;
  } = {}
): NextRequest {
  const cookieHeader = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  return new NextRequest(new URL(path, origin), {
    method,
    headers: cookieHeader ? { ...headers, cookie: cookieHeader } : headers,
  });
}

export interface SetCookie {
  value: string;
  attributes: string;
}

/** 응답의 Set-Cookie 에서 그 이름의 쿠키를 찾는다. 없으면 undefined. */
export function setCookieOf(response: Response, name: string): SetCookie | undefined {
  const header = response.headers.getSetCookie().find((cookie) => cookie.startsWith(`${name}=`));
  if (!header) return undefined;
  const [pair, ...attributes] = header.split("; ");
  return { value: decodeURIComponent(pair.slice(name.length + 1)), attributes: attributes.join("; ") };
}

export function locationOf(response: Response): URL {
  const location = response.headers.get("location");
  if (!location) throw new Error(`no location header (status ${response.status})`);
  return new URL(location);
}
