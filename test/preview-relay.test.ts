import { SignJWT } from "jose";
import { afterEach, describe, expect, it } from "vitest";
import { isAllowedPreviewOrigin, relayTargetOf, signRelayState } from "../src/preview-relay.js";
import { PREVIEW_ORIGIN } from "./helpers.js";

const PATTERN = "https://app-git-*-lemondouble.vercel.app";

describe("isAllowedPreviewOrigin", () => {
  it("브랜치 이름 자리만 바뀐 preview 주소를 허용한다", () => {
    expect(isAllowedPreviewOrigin(PREVIEW_ORIGIN, PATTERN)).toBe(true);
  });

  it.each([
    "https://app-git-x-lemondouble.vercel.app.evil.example",
    "https://app-git-a.b-lemondouble.vercel.app",
    "https://evil.example/app-git-x-lemondouble.vercel.app",
    "http://app-git-x-lemondouble.vercel.app",
    "https://app-git--lemondouble.vercel.app",
    "https://other-git-x-lemondouble.vercel.app",
    "https://app-git-x-lemondoubleXvercel.app",
  ])("패턴 밖의 주소 %s 는 거부한다", (origin) => {
    expect(isAllowedPreviewOrigin(origin, PATTERN)).toBe(false);
  });

  it("패턴을 설정하지 않았거나 https 가 아니면 아무것도 허용하지 않는다", () => {
    expect(isAllowedPreviewOrigin(PREVIEW_ORIGIN, undefined)).toBe(false);
    expect(isAllowedPreviewOrigin("http://app-git-x.test", "http://app-git-*.test")).toBe(false);
  });
});

describe("relayTargetOf", () => {
  afterEach(() => {
    delete process.env.LEMON_AUTH_PREVIEW_ORIGIN;
  });

  it("서명한 state 의 preview origin 을 돌려준다", async () => {
    process.env.LEMON_AUTH_PREVIEW_ORIGIN = PATTERN;
    expect(await relayTargetOf(await signRelayState(PREVIEW_ORIGIN))).toBe(PREVIEW_ORIGIN);
  });

  it("허용 패턴이 없으면 서명이 맞아도 넘기지 않는다", async () => {
    expect(await relayTargetOf(await signRelayState(PREVIEW_ORIGIN))).toBeNull();
  });

  it("다른 키로 서명했거나 형식이 다른 state 는 거부한다", async () => {
    process.env.LEMON_AUTH_PREVIEW_ORIGIN = PATTERN;
    const forged = await new SignJWT({ origin: PREVIEW_ORIGIN })
      .setProtectedHeader({ alg: "HS256", typ: "lemon-auth-relay+jwt" })
      .setExpirationTime("10m")
      .sign(new Uint8Array(32));
    expect(await relayTargetOf(forged)).toBeNull();
    expect(await relayTargetOf("random-state-value")).toBeNull();
    expect(await relayTargetOf(null)).toBeNull();
  });
});
