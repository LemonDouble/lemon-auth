import { SignJWT, UnsecuredJWT } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "../src/constants.js";
import { getAccessToken, getSession, lookupClient, requireAdmin, requireSession, verifyBearerToken } from "../src/server/index.js";
import { clearClientLookupCache } from "../src/server/client-lookup.js";
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

async function signIn(claims: Record<string, unknown>, session: Partial<StoredSession> = {}) {
  const idToken = await fake.op!.signIdToken("user-1", { name: "레몬", updated_at: 1000, groups: [], ...claims });
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

  describe("쿠키 키를 가진 사람이 꾸민 세션", () => {
    async function sealForged(idToken: string) {
      fake.cookies.set(
        SESSION_COOKIE,
        await sealSession({ refreshToken: "r", idToken, accessTokenExpiresAt: nowSeconds() + 600 })
      );
    }

    it("auth 서버 서명이 없는 ID Token 은 받지 않는다", async () => {
      const unsigned = new UnsecuredJWT({ name: "레몬", groups: ["admin"] })
        .setSubject("user-1")
        .setIssuer(ISSUER)
        .setAudience(CLIENT_ID)
        .setExpirationTime("30m")
        .encode();
      await sealForged(unsigned);
      expect(await getSession()).toEqual({ type: "none" });
    });

    it("다른 앱에 발급한 ID Token 은 받지 않는다", async () => {
      await sealForged(await fake.op!.signIdToken("user-1", { groups: ["admin"] }, { aud: OTHER_CLIENT_ID }));
      expect(await getSession()).toEqual({ type: "none" });
    });

    it("만료된 ID Token 은 받지 않는다 (로그 등에서 얻은 예전 토큰)", async () => {
      await sealForged(await fake.op!.signIdToken("user-1", { groups: ["admin"] }, { exp: nowSeconds() - 60 }));
      expect(await getSession()).toEqual({ type: "none" });
    });
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
      kind: "user",
      sub: "user-1",
      clientId: CLIENT_ID,
      scope: ["openid", "profile", "email"],
      groups: ["admin"],
      isAdmin: true,
    });
  });

  it("사용자 없이 프로그램이 받은 토큰은 service 로 구분한다", async () => {
    const service = { sub: OTHER_CLIENT_ID, name: "", groups: [] };
    const token = await fake.op!.signAccessToken(service, { clientId: OTHER_CLIENT_ID });
    expect(await verifyBearerToken(bearer(token))).toMatchObject({ kind: "service", sub: OTHER_CLIENT_ID, clientId: OTHER_CLIENT_ID, isAdmin: false });
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

describe("lookupClient", () => {
  afterEach(() => {
    clearClientLookupCache();
    fake.op!.state.unreachable = false;
    fake.op!.state.clientLookups = 0;
  });

  it("client_id 로 서비스 이름과 아이콘을 조회하고 잠시 기억한다", async () => {
    const expected = { clientId: OTHER_CLIENT_ID, name: "nightly-backup", iconUrl: `${ISSUER}/public/lemon-logo.webp` };
    expect(await lookupClient(OTHER_CLIENT_ID)).toEqual(expected);
    expect(await lookupClient(OTHER_CLIENT_ID)).toEqual(expected);
    expect(fake.op!.state.clientLookups).toBe(1);
  });

  it("없는 client 는 null 이다", async () => {
    expect(await lookupClient("33333333-3333-4333-8333-333333333333")).toBeNull();
  });

  it("auth 서버에 닿지 못하면 null 이고, 기억하지 않아 다음에 다시 묻는다", async () => {
    fake.op!.state.unreachable = true;
    expect(await lookupClient(OTHER_CLIENT_ID)).toBeNull();
    fake.op!.state.unreachable = false;
    expect(await lookupClient(OTHER_CLIENT_ID)).toMatchObject({ name: "nightly-backup" });
  });
});
