import { describe, expect, it } from "vitest";
import { safeNextPath } from "../src/next-path.js";
import { APP_ORIGIN } from "./helpers.js";

describe("safeNextPath", () => {
  it.each([
    ["/dashboard", "/dashboard"],
    ["/search?q=a&page=2", "/search?q=a&page=2"],
    ["/docs#section", "/docs#section"],
    ["/a/../b", "/b"],
  ])("앱 안의 경로 %s 는 그대로 쓴다", (raw, expected) => {
    expect(safeNextPath(raw, APP_ORIGIN)).toBe(expected);
  });

  it.each([
    null,
    "",
    "dashboard",
    "https://evil.example/",
    "//evil.example/",
    "/\\evil.example/",
    "\\\\evil.example/",
    "/\t/evil.example/",
    "/\n/evil.example/",
    "javascript:alert(1)",
    "/..//evil.example/",
    "/.//evil.example/",
    "/a/..//evil.example/",
    "/%2e%2e//evil.example/",
    "/%2E%2E//evil.example/",
    "/./%2e//evil.example/",
  ])("밖으로 나갈 수 있는 값 %j 는 첫 화면으로 바꾼다", (raw) => {
    expect(safeNextPath(raw, APP_ORIGIN)).toBe("/");
  });

  it("정규화한 결과를 다시 URL 로 읽어도 앱 밖으로 나가지 않는다", () => {
    for (const raw of ["/..//evil.example/", "/a/b/../..//evil.example", "/%2e//evil.example", "/x/%2E%2E//evil.example"]) {
      expect(new URL(safeNextPath(raw, APP_ORIGIN), APP_ORIGIN).origin).toBe(APP_ORIGIN);
    }
  });
});
