import { cache } from "react";
import { redirect } from "next/navigation";
import type { LemonUser } from "../types.js";
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

export async function requireAuth(redirectTo = "/"): Promise<LemonUser> {
  const user = await getUser();
  if (user) return user;
  redirect(redirectTo);
}

export async function requireClient(
  clientId: string,
  redirectTo = "/"
): Promise<LemonUser> {
  const user = await requireAuth(redirectTo);
  if (!user.approvedClients.includes(clientId)) {
    throw new Error("Client not approved");
  }
  return user;
}
