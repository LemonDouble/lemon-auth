import { decodeJwt, decodeProtectedHeader } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { LOGIN_TRANSACTION_COOKIE, SESSION_COOKIE } from "../src/constants.js";
import { GET, POST } from "../src/routes/index.js";
import { sealSession, unsealSession } from "../src/session.js";
import { CLIENT_ID, ISSUER, createFakeOp, type FakeOp } from "./fake-op.js";
import { APP_ORIGIN, PREVIEW_ORIGIN, appRequest, locationOf, setCookieOf } from "./helpers.js";

const fake = vi.hoisted(() => ({ op: undefined as FakeOp | undefined }));
vi.mock("../src/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/config.js")>()),
  getOidcConfiguration: async () => fake.op!.configuration,
}));

const USER = { sub: "user-1", name: "레몬", groups: [] };

beforeAll(async () => {
  fake.op = await createFakeOp();
});

afterEach(() => {
  delete process.env.LEMON_AUTH_REDIRECT_PROXY_URL;
  delete process.env.LEMON_AUTH_PREVIEW_ORIGIN;
  fake.op!.state.unreachable = false;
});

async function startLogin(next: string, origin = APP_ORIGIN) {
  const response = await GET(appRequest(`/auth/login?next=${encodeURIComponent(next)}`, { origin }));
  const transaction = setCookieOf(response, LOGIN_TRANSACTION_COOKIE);
  if (!transaction) throw new Error("login transaction cookie missing");
  return { authorizationUrl: locationOf(response), transactionCookie: transaction.value, response };
}

async function loggedInSessionCookie(): Promise<string> {
  const { authorizationUrl, transactionCookie } = await startLogin("/");
  const callbackUrl = await fake.op!.approve(authorizationUrl, USER);
  const response = await GET(
    appRequest(callbackUrl.pathname + callbackUrl.search, { cookies: { [LOGIN_TRANSACTION_COOKIE]: transactionCookie } })
  );
  return setCookieOf(response, SESSION_COOKIE)!.value;
}

describe("/auth/login", () => {
  it("PKCE, state, nonce 를 붙여 authorize 로 보내고 임시 쿠키를 남긴다", async () => {
    const { authorizationUrl, response } = await startLogin("/dashboard");
    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(`${ISSUER}/oauth/authorize`);
    const parameters = authorizationUrl.searchParams;
    expect(parameters.get("client_id")).toBe(CLIENT_ID);
    expect(parameters.get("redirect_uri")).toBe(`${APP_ORIGIN}/auth/callback`);
    expect(parameters.get("scope")).toBe("openid profile email");
    expect(parameters.get("code_challenge_method")).toBe("S256");
    expect(parameters.get("state")).toBeTruthy();
    expect(parameters.get("nonce")).toBeTruthy();
    expect(setCookieOf(response, LOGIN_TRANSACTION_COOKIE)!.attributes).toMatch(/Path=\/.*Max-Age=600.*Secure.*HttpOnly.*SameSite=lax/i);
  });

  it("preview 배포에서는 운영 콜백을 redirect_uri 로 쓰고 state 에 자기 origin 을 서명해 담는다", async () => {
    process.env.LEMON_AUTH_REDIRECT_PROXY_URL = `${APP_ORIGIN}/auth/callback`;
    const { authorizationUrl } = await startLogin("/", PREVIEW_ORIGIN);
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(`${APP_ORIGIN}/auth/callback`);
    expect(decodeJwt(authorizationUrl.searchParams.get("state")!).origin).toBe(PREVIEW_ORIGIN);
  });
});

describe("/auth/callback", () => {
  it("code 를 교환해 세션 쿠키를 만들고 처음 가려던 곳으로 보낸다", async () => {
    const { authorizationUrl, transactionCookie } = await startLogin("/dashboard?tab=1");
    const callbackUrl = await fake.op!.approve(authorizationUrl, USER);
    const response = await GET(
      appRequest(callbackUrl.pathname + callbackUrl.search, { cookies: { [LOGIN_TRANSACTION_COOKIE]: transactionCookie } })
    );

    expect(locationOf(response).href).toBe(`${APP_ORIGIN}/dashboard?tab=1`);
    expect(setCookieOf(response, LOGIN_TRANSACTION_COOKIE)!.attributes).toContain("Max-Age=0");
    const session = await unsealSession(setCookieOf(response, SESSION_COOKIE)!.value);
    expect(session?.refreshToken).toBeTruthy();
    expect(decodeJwt(session!.idToken).sub).toBe(USER.sub);
    expect(session?.accessToken).toBeUndefined();
  });

  it("로그인을 마친 뒤에도 next 로 앱 밖에 보내지 않는다", async () => {
    const { authorizationUrl, transactionCookie } = await startLogin("/%2e%2e//evil.example/");
    const callbackUrl = await fake.op!.approve(authorizationUrl, USER);
    const response = await GET(
      appRequest(callbackUrl.pathname + callbackUrl.search, { cookies: { [LOGIN_TRANSACTION_COOKIE]: transactionCookie } })
    );
    expect(locationOf(response).href).toBe(`${APP_ORIGIN}/`);
    expect(setCookieOf(response, SESSION_COOKIE)).toBeDefined();
  });

  it("LEMON_AUTH_KEEP_ACCESS_TOKEN 을 켠 앱은 access token 도 담는다", async () => {
    process.env.LEMON_AUTH_KEEP_ACCESS_TOKEN = "true";
    try {
      const session = await unsealSession(await loggedInSessionCookie());
      expect(decodeProtectedHeader(session!.accessToken!).typ).toBe("at+jwt");
      expect(decodeJwt(session!.accessToken!).client_id).toBe(CLIENT_ID);
    } finally {
      delete process.env.LEMON_AUTH_KEEP_ACCESS_TOKEN;
    }
  });

  it("OP 가 오류를 돌려주면 세션 없이 첫 화면으로 보낸다", async () => {
    const { authorizationUrl, transactionCookie } = await startLogin("/dashboard");
    const state = authorizationUrl.searchParams.get("state")!;
    const response = await GET(
      appRequest(`/auth/callback?error=access_denied&state=${state}&iss=${ISSUER}`, {
        cookies: { [LOGIN_TRANSACTION_COOKIE]: transactionCookie },
      })
    );
    expect(locationOf(response).href).toBe(`${APP_ORIGIN}/`);
    expect(setCookieOf(response, SESSION_COOKIE)).toBeUndefined();
  });

  it("로그인을 시작한 브라우저가 아니면(임시 쿠키가 없거나 state 가 다르면) 세션을 만들지 않는다", async () => {
    const { authorizationUrl, transactionCookie } = await startLogin("/");
    const callbackUrl = await fake.op!.approve(authorizationUrl, USER);

    const withoutCookie = await GET(appRequest(callbackUrl.pathname + callbackUrl.search));
    expect(setCookieOf(withoutCookie, SESSION_COOKIE)).toBeUndefined();

    const other = await startLogin("/");
    const withOtherCookie = await GET(
      appRequest(callbackUrl.pathname + callbackUrl.search, { cookies: { [LOGIN_TRANSACTION_COOKIE]: other.transactionCookie } })
    );
    expect(setCookieOf(withOtherCookie, SESSION_COOKIE)).toBeUndefined();
    expect(transactionCookie).not.toBe(other.transactionCookie);
  });

  it("iss 가 다른 응답은 받지 않는다 (RFC 9207)", async () => {
    const { authorizationUrl, transactionCookie } = await startLogin("/");
    const callbackUrl = await fake.op!.approve(authorizationUrl, USER);
    callbackUrl.searchParams.set("iss", "https://evil.example");
    const response = await GET(
      appRequest(callbackUrl.pathname + callbackUrl.search, { cookies: { [LOGIN_TRANSACTION_COOKIE]: transactionCookie } })
    );
    expect(setCookieOf(response, SESSION_COOKIE)).toBeUndefined();
  });
});

describe("preview 콜백 중계", () => {
  it("운영 콜백은 허용한 preview 로 code 를 넘기고, preview 는 운영 콜백 주소로 code 를 교환한다", async () => {
    process.env.LEMON_AUTH_REDIRECT_PROXY_URL = `${APP_ORIGIN}/auth/callback`;
    process.env.LEMON_AUTH_PREVIEW_ORIGIN = "https://app-git-*-lemondouble.vercel.app";

    const { authorizationUrl, transactionCookie } = await startLogin("/preview-page", PREVIEW_ORIGIN);
    const callbackUrl = await fake.op!.approve(authorizationUrl, USER);
    expect(callbackUrl.origin).toBe(APP_ORIGIN);

    const relayed = await GET(appRequest(callbackUrl.pathname + callbackUrl.search));
    const previewCallback = locationOf(relayed);
    expect(previewCallback.origin).toBe(PREVIEW_ORIGIN);
    expect(previewCallback.search).toBe(callbackUrl.search);
    expect(setCookieOf(relayed, SESSION_COOKIE)).toBeUndefined();

    const completed = await GET(
      appRequest(previewCallback.pathname + previewCallback.search, {
        origin: PREVIEW_ORIGIN,
        cookies: { [LOGIN_TRANSACTION_COOKIE]: transactionCookie },
      })
    );
    expect(locationOf(completed).href).toBe(`${PREVIEW_ORIGIN}/preview-page`);
    expect(setCookieOf(completed, SESSION_COOKIE)).toBeDefined();
  });

  it("허용 패턴에 맞지 않는 preview 로는 넘기지 않는다", async () => {
    process.env.LEMON_AUTH_REDIRECT_PROXY_URL = `${APP_ORIGIN}/auth/callback`;
    process.env.LEMON_AUTH_PREVIEW_ORIGIN = "https://other-git-*-lemondouble.vercel.app";

    const { authorizationUrl } = await startLogin("/", PREVIEW_ORIGIN);
    const callbackUrl = await fake.op!.approve(authorizationUrl, USER);
    const response = await GET(appRequest(callbackUrl.pathname + callbackUrl.search));
    expect(locationOf(response).origin).toBe(APP_ORIGIN);
  });
});

describe("/auth/logout", () => {
  it("id_token_hint 와 로그아웃 후 주소를 붙여 OP 로그아웃으로 보내고 세션을 지운다", async () => {
    const sessionCookie = await loggedInSessionCookie();
    const response = await POST(
      appRequest("/auth/logout", { method: "POST", cookies: { [SESSION_COOKIE]: sessionCookie }, headers: { origin: APP_ORIGIN } })
    );
    expect(response.status).toBe(303);
    const destination = locationOf(response);
    expect(destination.origin + destination.pathname).toBe(`${ISSUER}/oauth/logout`);
    expect(destination.searchParams.get("post_logout_redirect_uri")).toBe(`${APP_ORIGIN}/auth/logged-out`);
    expect(destination.searchParams.get("client_id")).toBe(CLIENT_ID);
    const session = await unsealSession(sessionCookie);
    expect(destination.searchParams.get("id_token_hint")).toBe(session!.idToken);
    expect(setCookieOf(response, SESSION_COOKIE)!.attributes).toContain("Max-Age=0");
  });

  it("다른 사이트에서 보낸 요청은 거부한다", async () => {
    const sessionCookie = await loggedInSessionCookie();
    const crossSite = await POST(
      appRequest("/auth/logout", { method: "POST", cookies: { [SESSION_COOKIE]: sessionCookie }, headers: { origin: "https://evil.example" } })
    );
    expect(crossSite.status).toBe(403);
    expect(setCookieOf(crossSite, SESSION_COOKIE)).toBeUndefined();

    const withoutOrigin = await POST(appRequest("/auth/logout", { method: "POST", headers: { "sec-fetch-site": "cross-site" } }));
    expect(withoutOrigin.status).toBe(403);
  });

  it("GET 으로는 로그아웃하지 않는다", async () => {
    expect((await GET(appRequest("/auth/logout"))).status).toBe(404);
  });
});

describe("프로필", () => {
  it("/auth/profile 은 돌아올 주소를 붙여 OP 프로필 화면으로 보낸다", async () => {
    const response = await GET(appRequest("/auth/profile?next=%2Fmy"));
    const destination = locationOf(response);
    expect(destination.origin + destination.pathname).toBe(`${ISSUER}/profile`);
    expect(destination.searchParams.get("redirect_url")).toBe(`${APP_ORIGIN}/auth/profile-return?next=%2Fmy`);
  });

  it("/auth/profile-return 은 그 자리에서 갱신해 바뀐 프로필을 세션에 반영한다", async () => {
    const sessionCookie = await loggedInSessionCookie();
    fake.op!.state.profileName = "바뀐 이름";
    try {
      const response = await GET(appRequest("/auth/profile-return?next=%2Fmy", { cookies: { [SESSION_COOKIE]: sessionCookie } }));
      expect(locationOf(response).href).toBe(`${APP_ORIGIN}/my`);
      const session = await unsealSession(setCookieOf(response, SESSION_COOKIE)!.value);
      expect(decodeJwt(session!.idToken).name).toBe("바뀐 이름");
      expect(session!.refreshToken).toBe((await unsealSession(sessionCookie))!.refreshToken);
    } finally {
      fake.op!.state.profileName = undefined;
    }
  });

  it("세션 없이 직접 들어와도 next 로 앱 밖에 보내지 않는다", async () => {
    const response = await GET(appRequest(`/auth/profile-return?next=${encodeURIComponent("/..//evil.example/")}`));
    expect(locationOf(response).href).toBe(`${APP_ORIGIN}/`);
  });

  it("OP 가 끝낸 세션이면 쿠키를 지운다", async () => {
    const sessionCookie = await sealSession({ refreshToken: "revoked", idToken: "a.b.c", accessTokenExpiresAt: 0 });
    const response = await GET(appRequest("/auth/profile-return?next=%2F", { cookies: { [SESSION_COOKIE]: sessionCookie } }));
    expect(setCookieOf(response, SESSION_COOKIE)!.attributes).toContain("Max-Age=0");
  });
});
