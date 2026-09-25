import { cache } from "react";
import { redirect } from "next/navigation";
import type { AccessTokenClaims, LemonSession, LemonUser } from "../types.js";
import { AUTH_SERVER_URL } from "../constants.js";
import { verifyAccessToken } from "./verify.js";

function claimsToUser(claims: AccessTokenClaims): LemonUser {
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

const getSessionByClientId = cache(
  async (clientId: string): Promise<LemonSession> => {
    const user = await getUser();
    if (!user) return { type: "none" };
    if (!isApprovedClient(user.approvedClients, clientId)) {
      return { type: "unapproved", user };
    }
    return { type: "authenticated", user };
  }
);

export async function getSession({
  clientId,
}: {
  clientId: string;
}): Promise<LemonSession> {
  return getSessionByClientId(clientId);
}

export async function requireClient(
  clientId: string,
  {
    loginRedirectTo = "/",
    unapprovedRedirectTo = `${AUTH_SERVER_URL}/error?code=FORBIDDEN`,
  }: { loginRedirectTo?: string; unapprovedRedirectTo?: string } = {}
): Promise<LemonUser> {
  const session = await getSession({ clientId });
  if (session.type === "none") redirect(loginRedirectTo);
  if (session.type === "unapproved") redirect(unapprovedRedirectTo);
  return session.user;
}

// clientId 가 비어 있으면(환경변수 누락) 아무도 승인되지 않는다. "*" 는 mock user 용이다.
function isApprovedClient(approvedClients: string[], clientId: string): boolean {
  if (!clientId) return false;
  return approvedClients.includes(clientId) || approvedClients.includes("*");
}
