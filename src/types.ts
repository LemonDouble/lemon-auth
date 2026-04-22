import type { JWTPayload } from "jose";

export interface AccessTokenClaims extends JWTPayload {
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

export interface UserProfile {
  uid: string;
  nickname: string;
  profile_image_url: string;
  role: "user" | "admin";
}
