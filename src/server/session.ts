import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { loginUrl } from "../client/url.js";
import { keepsAccessToken } from "../config.js";
import { SESSION_COOKIE } from "../constants.js";
import { getMockUser } from "../mock.js";
import { accessTokenFromSession, isExpired, unsealSession, userFromSession } from "../session.js";
import type { AccessToken, LemonSession, LemonUser } from "../types.js";

/** 갱신은 proxy 가 하므로, 여기서는 쿠키를 읽기만 한다. */
const readLiveSession = cache(async () => {
  const session = await unsealSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session || isExpired(session)) return null;
  return session;
});

export const getSession = cache(async (): Promise<LemonSession> => {
  const mockUser = getMockUser();
  if (mockUser) return { type: "authenticated", user: mockUser };

  const session = await readLiveSession();
  if (!session) return { type: "none" };
  return { type: "authenticated", user: userFromSession(session) };
});

/** 로그인하지 않았으면 로그인 화면으로 보낸다. 로그인을 마치면 `next` 로 돌아온다. */
export async function requireSession(next = "/"): Promise<LemonUser> {
  const session = await getSession();
  if (session.type === "none") redirect(loginUrl(next));
  return session.user;
}

/** 관리자가 아니면 404 로 응답한다. Next.js 의 forbidden() 은 아직 실험 기능이라 쓰지 않는다. */
export async function requireAdmin(next = "/"): Promise<LemonUser> {
  const user = await requireSession(next);
  if (!user.isAdmin) notFound();
  return user;
}

/**
 * 브라우저가 다른 API 서버를 직접 부를 때 쓸 access token (Token-Mediating Backend, https://datatracker.ietf.org/doc/html/draft-ietf-oauth-browser-based-apps#section-6.2).
 * LEMON_AUTH_KEEP_ACCESS_TOKEN=true 인 앱만 쓸 수 있다. 응답에는 `Cache-Control: no-store` 를 붙인다.
 */
export async function getAccessToken(): Promise<AccessToken | null> {
  if (!keepsAccessToken()) {
    throw new Error("[lemon-auth] getAccessToken() needs LEMON_AUTH_KEEP_ACCESS_TOKEN=true");
  }
  const session = await readLiveSession();
  return session ? accessTokenFromSession(session) : null;
}
