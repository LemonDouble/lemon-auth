import { cache } from "react";
import { redirect } from "next/navigation";
import type { LemonSession, LemonUser } from "../types.js";
import { AUTH_SERVER_URL } from "../constants.js";
import { isApprovedClient } from "../approval.js";
import { verifyAccessToken } from "./verify.js";

function claimsToUser(
  claims: NonNullable<Awaited<ReturnType<typeof verifyAccessToken>>>
): LemonUser {
  return {
    uid: claims.sub,
    nickname: claims.nickname,
    profileImageUrl: claims.profile_image_url,
    role: claims.role,
    approvedClients: claims.approved_clients,
  };
}

export const getUser = cache(async (): Promise<LemonUser | null> => {
  const claims = await verifyAccessToken();
  if (!claims) return null;
  return claimsToUser(claims);
});

export interface GetSessionOptions {
  clientId?: string;
}

const getSessionByClientId = cache(
  async (clientId?: string): Promise<LemonSession> => {
    const user = await getUser();
    if (!user) return { type: "none" };
    if (!isApprovedClient(user.approvedClients, clientId)) {
      return { type: "unapproved", user };
    }
    return { type: "authenticated", user };
  }
);

export async function getSession(
  options: GetSessionOptions = {}
): Promise<LemonSession> {
  return getSessionByClientId(options.clientId);
}

export async function requireAuth(redirectTo = "/"): Promise<LemonUser> {
  const user = await getUser();
  if (user) return user;
  redirect(redirectTo);
}

export interface RequireClientOptions {
  loginRedirectTo?: string;
  unapprovedRedirectTo?: string;
}

export async function requireClient(
  clientId: string,
  optionsOrRedirectTo: string | RequireClientOptions = "/"
): Promise<LemonUser> {
  const options =
    typeof optionsOrRedirectTo === "string"
      ? { loginRedirectTo: optionsOrRedirectTo }
      : optionsOrRedirectTo;
  const session = await getSession({ clientId });
  if (session.type === "none") {
    redirect(options.loginRedirectTo ?? "/");
  }
  if (session.type === "unapproved") {
    redirect(
      options.unapprovedRedirectTo ??
        `${AUTH_SERVER_URL}/error?code=FORBIDDEN`
    );
  }
  return session.user;
}
