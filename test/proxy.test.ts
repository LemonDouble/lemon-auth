import { decodeJwt } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { LOGIN_TRANSACTION_COOKIE, SESSION_COOKIE } from "../src/constants.js";
import { createAuthProxy } from "../src/proxy/index.js";
import { GET } from "../src/routes/index.js";
import { sealSession, unsealSession, type StoredSession } from "../src/session.js";
import { createFakeOp, type FakeOp } from "./fake-op.js";
import { APP_ORIGIN, appRequest, locationOf, setCookieOf } from "./helpers.js";

const fake = vi.hoisted(() => ({ op: undefined as FakeOp | undefined }));
vi.mock("../src/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/config.js")>()),
  getOidcConfiguration: async () => fake.op!.configuration,
}));

const proxy = createAuthProxy({ publicPaths: ["/", "/about"] });
const nowSeconds = () => Math.floor(Date.now() / 1000);

beforeAll(async () => {
  fake.op = await createFakeOp();
});

afterEach(() => {
  fake.op!.state.unreachable = false;
});

/** OP 에서 로그인을 마친 세션을 만들고, access token 만료 시각만 바꾼다. */
async function sessionExpiringIn(seconds: number): Promise<StoredSession> {
  const login = await GET(appRequest("/auth/login?next=%2F"));
  const callbackUrl = await fake.op!.approve(locationOf(login), { sub: "user-1", name: "레몬", groups: [] });
  const callback = await GET(
    appRequest(callbackUrl.pathname + callbackUrl.search, {
      cookies: { [LOGIN_TRANSACTION_COOKIE]: setCookieOf(login, LOGIN_TRANSACTION_COOKIE)!.value },
    })
  );
  const session = await unsealSession(setCookieOf(callback, SESSION_COOKIE)!.value);
  return { ...session!, accessTokenExpiresAt: nowSeconds() + seconds };
}

async function requestWith(path: string, session?: StoredSession | string, method = "GET") {
  const cookie = typeof session === "string" ? session : session && (await sealSession(session));
  return proxy(appRequest(path, { method, cookies: cookie ? { [SESSION_COOKIE]: cookie } : {} }));
}

/** proxy 가 바꿔서 넘긴 요청 쿠키. 이번 요청을 처리하는 페이지가 읽는 값이다. */
function forwardedSessionCookie(response: Response): string | undefined {
  expect(response.headers.get("x-middleware-override-headers")).toContain("cookie");
  const forwarded = response.headers.get("x-middleware-request-cookie") ?? "";
  const pair = forwarded.split("; ").find((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`));
  return pair ? decodeURIComponent(pair.slice(SESSION_COOKIE.length + 1)) : undefined;
}

describe("세션이 없을 때", () => {
  it("보호한 화면은 돌아올 주소를 붙여 로그인으로 보낸다", async () => {
    const response = await requestWith("/dashboard?tab=1");
    expect(locationOf(response).href).toBe(`${APP_ORIGIN}/auth/login?next=${encodeURIComponent("/dashboard?tab=1")}`);
  });

  it("API 는 401 을 돌려준다", async () => {
    const response = await requestWith("/api/items");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: "UNAUTHORIZED" });
  });

  it("공개 경로, /auth/*, Bearer 요청, GET 이 아닌 요청은 그대로 통과시킨다", async () => {
    expect((await requestWith("/about")).headers.get("x-middleware-next")).toBe("1");
    expect((await requestWith("/auth/callback")).headers.get("x-middleware-next")).toBe("1");
    expect((await requestWith("/dashboard", undefined, "POST")).headers.get("x-middleware-next")).toBe("1");
    const bearer = await proxy(appRequest("/api/files", { headers: { authorization: "Bearer token" } }));
    expect(bearer.headers.get("x-middleware-next")).toBe("1");
  });

  it("열 수 없는 세션 쿠키는 지운다", async () => {
    const response = await requestWith("/about", "garbage");
    expect(setCookieOf(response, SESSION_COOKIE)!.attributes).toContain("Max-Age=0");
    expect(forwardedSessionCookie(response)).toBeUndefined();
  });
});

describe("세션이 있을 때", () => {
  it("만료까지 여유가 있으면 auth 서버를 부르지 않고 통과시킨다", async () => {
    const session = await sessionExpiringIn(600);
    fake.op!.state.unreachable = true;
    const response = await requestWith("/dashboard", session);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(setCookieOf(response, SESSION_COOKIE)).toBeUndefined();
  });

  it("만료가 다가오면 갱신해 브라우저 쿠키와 이번 요청의 쿠키를 함께 바꾼다", async () => {
    const response = await requestWith("/dashboard", await sessionExpiringIn(30));
    const renewed = await unsealSession(setCookieOf(response, SESSION_COOKIE)!.value);
    expect(renewed!.accessTokenExpiresAt).toBeGreaterThan(nowSeconds() + 1700);
    expect(decodeJwt(renewed!.idToken).sub).toBe("user-1");
    expect(await unsealSession(forwardedSessionCookie(response))).toEqual(renewed);
  });

  it("OP 가 갱신을 거절하면(로그아웃, 기기 해제) 세션을 지우고 로그인 전 상태로 처리한다", async () => {
    const session = await sessionExpiringIn(30);
    fake.op!.endAllSessions();
    const response = await requestWith("/dashboard", session);
    expect(locationOf(response).pathname).toBe("/auth/login");
    expect(setCookieOf(response, SESSION_COOKIE)!.attributes).toContain("Max-Age=0");

    const publicPage = await requestWith("/about", session);
    expect(publicPage.headers.get("x-middleware-next")).toBe("1");
    expect(forwardedSessionCookie(publicPage)).toBeUndefined();
  });

  it("auth 서버에 닿지 못하면 만료 전까지는 세션을 그대로 쓰고, 쿠키는 남겨 둔다", async () => {
    const almostExpired = await sessionExpiringIn(30);
    const expired = { ...almostExpired, accessTokenExpiresAt: nowSeconds() - 1 };
    fake.op!.state.unreachable = true;

    const beforeExpiry = await requestWith("/dashboard", almostExpired);
    expect(beforeExpiry.headers.get("x-middleware-next")).toBe("1");
    expect(setCookieOf(beforeExpiry, SESSION_COOKIE)).toBeUndefined();

    const afterExpiry = await requestWith("/dashboard", expired);
    expect(locationOf(afterExpiry).pathname).toBe("/auth/login");
    expect(setCookieOf(afterExpiry, SESSION_COOKIE)).toBeUndefined();
  });
});
