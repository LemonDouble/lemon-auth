/** ID Token 의 사용자 정보. `isAdmin` 은 MFA 를 거친 관리자 로그인에서만 true 다. */
export interface LemonUser {
  sub: string;
  name: string;
  picture: string | null;
  email: string | null;
  groups: string[];
  isAdmin: boolean;
  /** 프로필을 마지막으로 바꾼 시각 (초). 앱이 프로필 복사본을 갱신할 때 비교한다. */
  updatedAt: number;
}

export type LemonSession =
  | { type: "none" }
  | { type: "authenticated"; user: LemonUser };

/** 다른 프로그램(lemon-cli 등)이 `Authorization: Bearer` 로 보낸 access token. 프로필은 없다. */
export interface BearerToken {
  /** user: 사용자가 로그인해 받은 토큰. service: 사용자 없이 프로그램이 자기 이름으로 받은 토큰 (client_credentials) */
  kind: "user" | "service";
  sub: string;
  clientId: string;
  scope: string[];
  groups: string[];
  isAdmin: boolean;
}

/** auth 서버에 등록된 서비스. `lookupClient()` 가 돌려준다. */
export interface ClientInfo {
  clientId: string;
  name: string;
  iconUrl: string;
}

export interface AccessToken {
  value: string;
  /** 만료 시각 (초) */
  expiresAt: number;
}
