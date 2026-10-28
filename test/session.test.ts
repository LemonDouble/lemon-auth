import { afterEach, describe, expect, it } from "vitest";
import { sealLoginTransaction } from "../src/routes/login-transaction.js";
import { sealSession, unsealSession, type StoredSession } from "../src/session.js";
import { TEST_SECRET } from "./setup.js";

const session: StoredSession = {
  refreshToken: "refresh-token",
  idToken: "header.payload.signature",
  accessTokenExpiresAt: 2_000_000_000,
};

describe("세션 쿠키", () => {
  afterEach(() => {
    process.env.LEMON_AUTH_SECRET = TEST_SECRET;
  });

  it("암호화한 값을 같은 키로 다시 연다", async () => {
    const sealed = await sealSession(session);
    expect(sealed).not.toContain("refresh-token");
    expect(await unsealSession(sealed)).toEqual(session);
  });

  it("키가 바뀌면 열지 못하고 없는 세션으로 본다", async () => {
    const sealed = await sealSession(session);
    process.env.LEMON_AUTH_SECRET = Buffer.alloc(32, 7).toString("base64");
    expect(await unsealSession(sealed)).toBeNull();
  });

  it("값을 조금이라도 바꾸면 열지 못한다", async () => {
    const sealed = await sealSession(session);
    const parts = sealed.split(".");
    parts[3] = (parts[3][0] === "A" ? "B" : "A") + parts[3].slice(1);
    const tampered = parts.join(".");
    expect(await unsealSession(tampered)).toBeNull();
  });

  it("로그인 임시 쿠키를 세션 쿠키 자리에 넣어도 세션으로 쓰이지 않는다", async () => {
    const transaction = await sealLoginTransaction({
      state: "s",
      nonce: "n",
      codeVerifier: "v",
      redirectUri: "https://app.lemondouble.com/auth/callback",
      next: "/",
      silent: false,
    });
    expect(await unsealSession(transaction)).toBeNull();
  });

  it("비밀값이 32바이트가 아니면 시작하지 않는다", async () => {
    process.env.LEMON_AUTH_SECRET = "too-short";
    await expect(sealSession(session)).rejects.toThrow("LEMON_AUTH_SECRET");
  });
});
