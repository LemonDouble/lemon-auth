import type { JWTPayload } from "jose";

export interface AccessTokenClaims extends JWTPayload {
  token_type: "access";
  sub: string;
  nickname: string;
  profile_image_url: string;
  role: "user" | "admin";
  approved_clients: string[];
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

export interface UserProfile {
  uid: string;
  nickname: string;
  profile_image_url: string;
  role: "user" | "admin";
}
