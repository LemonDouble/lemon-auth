import * as client from "openid-client";
import { NextResponse, type NextRequest } from "next/server";
import { getOidcConfiguration, issuerUrl, redirectProxyUrl } from "../config.js";
import {
  CALLBACK_PATH,
  LOGGED_OUT_PATH,
  LOGIN_TRANSACTION_COOKIE,
  PROFILE_RETURN_PATH,
  SCOPE,
  SESSION_COOKIE,
} from "../constants.js";
import { errorCode, warnAuth } from "../log.js";
import { isMockAuthEnabled } from "../mock.js";
import { safeNextPath } from "../next-path.js";
import { relayTargetOf, signRelayState } from "../preview-relay.js";
import { deleteCookie, setCookie } from "../sealed-cookie.js";
import {
  SESSION_MAX_AGE_SECONDS,
  refreshSession,
  sealSession,
  sessionFromTokens,
  unsealSession,
  type StoredSession,
} from "../session.js";
import {
  LOGIN_TRANSACTION_MAX_AGE_SECONDS,
  sealLoginTransaction,
  unsealLoginTransaction,
  type LoginTransaction,
} from "./login-transaction.js";

/** 앱은 `app/auth/[...lemon]/route.ts` 에서 `export { GET, POST } from "@lemondouble/lemon-auth/routes"` 만 한다. */
export async function GET(request: NextRequest): Promise<Response> {
  switch (request.nextUrl.pathname) {
    case "/auth/login":
      return startLogin(request);
    case CALLBACK_PATH:
      return handleCallback(request);
    case LOGGED_OUT_PATH:
      return redirectTo(request, "/");
    case "/auth/profile":
      return openProfile(request);
    case PROFILE_RETURN_PATH:
      return returnFromProfile(request);
    default:
      return new NextResponse(null, { status: 404 });
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  if (request.nextUrl.pathname === "/auth/logout") return logout(request);
  return new NextResponse(null, { status: 404 });
}

async function startLogin(request: NextRequest): Promise<Response> {
  const origin = request.nextUrl.origin;
  const next = safeNextPath(request.nextUrl.searchParams.get("next"), origin);
  if (isMockAuthEnabled()) return redirectTo(request, next);

  const configuration = await getOidcConfiguration();
  const proxyUrl = redirectProxyUrl();
  const isPreview = proxyUrl !== null && proxyUrl.origin !== origin;
  const transaction: LoginTransaction = {
    state: isPreview ? await signRelayState(origin) : client.randomState(),
    nonce: client.randomNonce(),
    codeVerifier: client.randomPKCECodeVerifier(),
    redirectUri: isPreview ? proxyUrl.href : origin + CALLBACK_PATH,
    next,
  };
  const authorizationUrl = client.buildAuthorizationUrl(configuration, {
    redirect_uri: transaction.redirectUri,
    scope: SCOPE,
    state: transaction.state,
    nonce: transaction.nonce,
    code_challenge: await client.calculatePKCECodeChallenge(transaction.codeVerifier),
    code_challenge_method: "S256",
  });

  const response = NextResponse.redirect(authorizationUrl);
  setCookie(response, LOGIN_TRANSACTION_COOKIE, await sealLoginTransaction(transaction), LOGIN_TRANSACTION_MAX_AGE_SECONDS);
  return response;
}

async function handleCallback(request: NextRequest): Promise<Response> {
  const origin = request.nextUrl.origin;
  if (redirectProxyUrl()?.origin === origin) {
    const previewOrigin = await relayTargetOf(request.nextUrl.searchParams.get("state"));
    if (previewOrigin && previewOrigin !== origin) {
      return NextResponse.redirect(new URL(CALLBACK_PATH + request.nextUrl.search, previewOrigin));
    }
  }

  const transaction = await unsealLoginTransaction(request.cookies.get(LOGIN_TRANSACTION_COOKIE)?.value);
  const response = await completeLogin(request, transaction);
  deleteCookie(response, LOGIN_TRANSACTION_COOKIE);
  return response;
}

/** 실패하면 오류 종류와 관계없이 로그인 전 상태로 앱 첫 화면을 보여 준다. 사용자가 볼 오류 화면은 OP 가 이미 보여 주었다. */
async function completeLogin(request: NextRequest, transaction: LoginTransaction | null): Promise<NextResponse> {
  const parameters = request.nextUrl.searchParams;
  if (!transaction || parameters.get("state") !== transaction.state) {
    warnAuth("callback without matching login transaction");
    return redirectTo(request, "/");
  }
  const authorizationError = parameters.get("error");
  if (authorizationError) {
    if (authorizationError !== "access_denied") {
      warnAuth("authorization error", { error: authorizationError });
    }
    return redirectTo(request, "/");
  }

  // code 교환에 보내는 redirect_uri 는 이 URL 에서 query 를 뗀 값이라, authorize 에 보낸 주소로 만든다.
  const callbackUrl = new URL(transaction.redirectUri);
  callbackUrl.search = request.nextUrl.search;
  try {
    const configuration = await getOidcConfiguration();
    const tokens = await client.authorizationCodeGrant(configuration, callbackUrl, {
      pkceCodeVerifier: transaction.codeVerifier,
      expectedState: transaction.state,
      expectedNonce: transaction.nonce,
      idTokenExpected: true,
    });
    const response = redirectTo(request, transaction.next);
    setCookie(response, SESSION_COOKIE, await sealSession(sessionFromTokens(tokens)), SESSION_MAX_AGE_SECONDS);
    return response;
  } catch (error) {
    warnAuth("authorization code exchange failed", { code: errorCode(error) });
    return redirectTo(request, "/");
  }
}

/** OP 의 프로필 화면에서 [돌아가기] 를 누르면 `/auth/profile-return` 으로 돌아온다. */
function openProfile(request: NextRequest): Response {
  const origin = request.nextUrl.origin;
  const next = safeNextPath(request.nextUrl.searchParams.get("next"), origin);
  if (isMockAuthEnabled()) return redirectTo(request, next);

  const returnUrl = new URL(PROFILE_RETURN_PATH, origin);
  returnUrl.searchParams.set("next", next);
  const profileUrl = new URL("/profile", issuerUrl());
  profileUrl.searchParams.set("redirect_url", returnUrl.href);
  return NextResponse.redirect(profileUrl);
}

/** 바꾼 프로필을 다음 갱신(최대 30분)까지 기다리지 않고 바로 반영한다. */
async function returnFromProfile(request: NextRequest): Promise<Response> {
  const next = safeNextPath(request.nextUrl.searchParams.get("next"), request.nextUrl.origin);
  const response = redirectTo(request, next);
  const session = await unsealSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session || isMockAuthEnabled()) return response;

  const result = await refreshSession(session);
  if (result.type === "refreshed") {
    setCookie(response, SESSION_COOKIE, await sealSession(result.session), SESSION_MAX_AGE_SECONDS);
  }
  if (result.type === "ended") deleteCookie(response, SESSION_COOKIE);
  return response;
}

/** 앱 세션을 지우고 OP 세션도 끝낸다. 같은 브라우저의 다른 앱도 다음 갱신 때 로그아웃된다. */
async function logout(request: NextRequest): Promise<Response> {
  if (!isSameOriginRequest(request)) return new NextResponse(null, { status: 403 });

  const session = await unsealSession(request.cookies.get(SESSION_COOKIE)?.value);
  const destination =
    session && !isMockAuthEnabled() ? await endSessionUrl(request, session) : new URL("/", request.nextUrl.origin);
  // POST 를 받은 뒤 GET 으로 이동하도록 303 을 쓴다.
  const response = NextResponse.redirect(destination, 303);
  deleteCookie(response, SESSION_COOKIE);
  return response;
}

async function endSessionUrl(request: NextRequest, session: StoredSession): Promise<URL> {
  try {
    const configuration = await getOidcConfiguration();
    return client.buildEndSessionUrl(configuration, {
      id_token_hint: session.idToken,
      post_logout_redirect_uri: request.nextUrl.origin + LOGGED_OUT_PATH,
    });
  } catch (error) {
    warnAuth("end session url unavailable", { code: errorCode(error) });
    return new URL("/", request.nextUrl.origin);
  }
}

/** 다른 사이트의 form 이 사용자를 몰래 로그아웃시키지 못하게, 앱 자신의 화면에서 보낸 요청만 받는다. */
function isSameOriginRequest(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (origin) return origin === request.nextUrl.origin;
  return request.headers.get("sec-fetch-site") === "same-origin";
}

function redirectTo(request: NextRequest, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, request.nextUrl.origin));
}
