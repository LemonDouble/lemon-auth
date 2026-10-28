export const DEFAULT_ISSUER = "https://auth.lemondouble.com";
export const SCOPE = "openid profile email";

export const SESSION_COOKIE = "__Host-lemon_auth";
export const LOGIN_TRANSACTION_COOKIE = "__Host-lemon_auth_tx";
/** 조용한 로그인(prompt=none)을 이 브라우저에서 이미 시도했다는 표시. 브라우저를 닫으면 사라진다. */
export const SILENT_LOGIN_ATTEMPTED_COOKIE = "__Host-lemon_auth_silent";
/** OP 프로필 화면에 다녀오는 중이라는 표시. 뒤로 가기로 돌아와도 다음 요청에서 바뀐 프로필을 받는다. */
export const PROFILE_PENDING_COOKIE = "__Host-lemon_auth_profile";
/** 쿠키를 저장하지 못하는 브라우저에서 조용한 로그인이 반복되지 않게, 실패하고 돌아온 주소에 붙이는 표시 */
export const SILENT_LOGIN_SKIP_PARAM = "lemon_auth_silent";

/** 앱의 `app/auth/[...lemon]/route.ts` 가 받는 경로 */
export const AUTH_ROUTE_PREFIX = "/auth/";
export const CALLBACK_PATH = "/auth/callback";
export const LOGGED_OUT_PATH = "/auth/logged-out";
export const PROFILE_RETURN_PATH = "/auth/profile-return";
