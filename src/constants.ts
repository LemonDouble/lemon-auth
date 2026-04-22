export const AUTH_SERVER_URL = "https://auth.lemondouble.com";
export const JWKS_URL = `${AUTH_SERVER_URL}/.well-known/jwks.json`;
export const LOGIN_URL = `${AUTH_SERVER_URL}/api/oauth2/google/login`;
export const REFRESH_URL = `${AUTH_SERVER_URL}/api/token/refresh`;
export const LOGOUT_URL = `${AUTH_SERVER_URL}/api/token/logout`;
export const PROFILE_URL = `${AUTH_SERVER_URL}/api/user/me`;
export const PROFILE_PAGE_URL = `${AUTH_SERVER_URL}/profile`;

export const ACCESS_TOKEN_COOKIE = "access_token";
export const REFRESH_TOKEN_COOKIE = "refresh_token";
