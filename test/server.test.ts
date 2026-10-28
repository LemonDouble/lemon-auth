import { SignJWT, UnsecuredJWT } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "../src/constants.js";
import { getAccessToken, getSession, requireAdmin, requireSession, verifyBearerToken } from "../src/server/index.js";
import { sealSession, type StoredSession } from "../src/session.js";
import { CLIENT_ID, ISSUER, OTHER_CLIENT_ID, createFakeOp, type FakeOp } from "./fake-op.js";

const fake = vi.hoisted(() => ({ op: undefined as FakeOp | undefined, cookies: new Map<string, string>() }));
vi.mock("../src/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/config.js")>()),
  getOidcConfiguration: async () => fake.op!.configuration,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (fake.cookies.has(name) ? { value: fake.cookies.get(name) } : undefined) }),
}));
// 서버 함수는 react 의 cache() 로 요청마다 한 번만 읽는다. 테스트에서는 호출마다 다시 읽는다.
vi.mock("react", () => ({ cache: <T>(callback: T) => callback }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));

const nowSeconds = () => Math.floor(Date.now() / 1000);

beforeAll(async () => {
  fake.op = await createFakeOp();
  vi.stubGlobal("fetch", fake.op.fetch);
});

afterEach(() => {
  fake.cookies.clear();
  delete process.env.LEMON_AUTH_MOCK;
  delete process.env.LEMON_AUTH_KEEP_ACCESS_TOKEN;
});

/** 세션 쿠키 안의 ID Token 은 받을 때 이미 검증했으므로, 여기서는 서명 없는 토큰으로 충분하다. */
async function signIn(claims: Record<string, unknown>, session: Partial<StoredSession> = {}) {
  const idToken = new UnsecuredJWT({ name: "레몬", updated_at: 1000, groups: [], ...claims }).setSubject("user-1").encode();
  fake.cookies.set(
    SESSION_COOKIE,
    await sealSession({ refreshToken: "r", idToken, accessTokenExpiresAt: nowSeconds() + 600, ...session })
  );
}

describe("getSession", () => {
  it("세션 쿠키의 ID Token 에서 사용자 정보를 읽는다", async () => {
    await signIn({ picture: "https://img.test/a.png?v=1", email: "a@test", groups: ["admin"] });
    expect(await getSession()).toEqual({
      type: "authenticated",
      user: {
        sub: "user-1",
        name: "레몬",
        picture: "https://img.test/a.png?v=1",
        email: "a@test",
        groups: ["admin"],
        isAdmin: true,
        updatedAt: 1000,
      },
    });
  });

  it("access token 이 만료된 세션은 로그인 전 상태로 본다", async () => {
    await signIn({}, { accessTokenExpiresAt: nowSeconds() - 1 });
    expect(await getSession()).toEqual({ type: "none" });
  });

  it("mock 모드에서는 가짜 사용자를 돌려준다", async () => {
    process.env.LEMON_AUTH_MOCK = JSON.stringify({ sub: "mock", name: "테스트", groups: ["admin"] });
    const session = await getSession();
    expect(session.type === "authenticated" && session.user).toMatchObject({ sub: "mock", isAdmin: true, picture: null });
  });
});

describe("requireSession, requireAdmin", () => {
  it("세션이 없으면 로그인으로 보낸다", async () => {
    await expect(requireSession("/my")).rejects.toThrow(`redirect:/auth/login?next=${encodeURIComponent("/my")}`);
  });

  it("관리자가 아니면 404 로 응답한다", async () => {
    await signIn({ groups: [] });
    await expect(requireAdmin()).rejects.toThrow("notFound");
    await signIn({ groups: ["admin"] });
    await expect(requireAdmin()).resolves.toMatchObject({ isAdmin: true });
  });
});

describe("getAccessToken", () => {
  it("LEMON_AUTH_KEEP_ACCESS_TOKEN 을 켜지 않은 앱에서 부르면 설정 오류를 알린다", async () => {
    await expect(getAccessToken()).rejects.toThrow("LEMON_AUTH_KEEP_ACCESS_TOKEN");
  });

  it("세션에 담은 access token 과 만료 시각을 돌려준다", async () => {
    process.env.LEMON_AUTH_KEEP_ACCESS_TOKEN = "true";
    const expiresAt = nowSeconds() + 600;
    await signIn({}, { accessToken: "access-token", accessTokenExpiresAt: expiresAt });
    expect(await getAccessToken()).toEqual({ value: "access-token", expiresAt });
  });
});

describe("verifyBearerToken", () => {
  const user = { sub: "user-1", name: "레몬", groups: ["admin"] };
  const bearer = (token: string) => new Request("https://app.test/api/files", { headers: { authorization: `Bearer ${token}` } });

  it("이 앱이 aud 에 있는 access token 을 받는다", async () => {
    const token = await fake.op!.signAccessToken(user, { aud: [OTHER_CLIENT_ID, CLIENT_ID] });
    expect(await verifyBearerToken(bearer(token))).toEqual({
      sub: "user-1",
      clientId: CLIENT_ID,
      scope: ["openid", "profile", "email"],
      groups: ["admin"],
      isAdmin: true,
    });
  });

  it("다른 앱에 발급한 토큰, ID Token, 만료된 토큰은 거부한다", async () => {
    expect(await verifyBearerToken(bearer(await fake.op!.signAccessToken(user, { aud: [OTHER_CLIENT_ID] })))).toBeNull();
    expect(await verifyBearerToken(bearer(await fake.op!.signAccessToken(user, { typ: "JWT" })))).toBeNull();
    expect(await verifyBearerToken(bearer(await fake.op!.signAccessToken(user, { exp: nowSeconds() - 60 })))).toBeNull();
  });

  it("다른 키로 서명한 토큰과 헤더가 없는 요청은 거부한다", async () => {
    const forged = await new SignJWT({ client_id: CLIENT_ID })
      .setProtectedHeader({ alg: "HS256", typ: "at+jwt" })
      .setIssuer(ISSUER)
      .setAudience(CLIENT_ID)
      .setSubject("user-1")
      .setExpirationTime("30m")
      .sign(new Uint8Array(32));
    expect(await verifyBearerToken(bearer(forged))).toBeNull();
    expect(await verifyBearerToken(new Request("https://app.test/api/files"))).toBeNull();
  });
});
