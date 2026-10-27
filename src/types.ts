import type { JWTPayload } from "jose";

/** RFC 9068 access token. `aud` 는 auth 서버와 이 유저가 승인받은 client 들이다. */
export interface AccessTokenClaims extends JWTPayload {
  sub: string;
  aud: string[];
  client_id: string;
  nickname: string;
  profile_image_url: string;
  role: "user" | "admin";
}

export interface LemonUser {
  uid: string;
  nickname: string;
  profileImageUrl: string;
  role: "user" | "admin";
  approvedClients: string[];
}

export type LemonSession =
  | { type: "none" }
  | { type: "unapproved"; user: LemonUser }
  | { type: "authenticated"; user: LemonUser };
