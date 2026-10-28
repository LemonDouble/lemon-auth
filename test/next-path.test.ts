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
  ])("밖으로 나갈 수 있는 값 %j 는 첫 화면으로 바꾼다", (raw) => {
    expect(safeNextPath(raw, APP_ORIGIN)).toBe("/");
  });
});
