export const DEFAULT_ISSUER = "https://auth.lemondouble.com";
export const SCOPE = "openid profile email";

export const SESSION_COOKIE = "__Host-lemon_auth";
export const LOGIN_TRANSACTION_COOKIE = "__Host-lemon_auth_tx";

/** 앱의 `app/auth/[...lemon]/route.ts` 가 받는 경로 */
export const AUTH_ROUTE_PREFIX = "/auth/";
export const CALLBACK_PATH = "/auth/callback";
export const LOGGED_OUT_PATH = "/auth/logged-out";
export const PROFILE_RETURN_PATH = "/auth/profile-return";
