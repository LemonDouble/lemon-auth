import * as client from "openid-client";
import { DEFAULT_ISSUER } from "./constants.js";

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`[lemon-auth] ${name} is required`);
  return value;
}

/** 스테이징이나 로컬 auth 서버로 검증할 때만 바꾼다. */
export function issuerUrl(): string {
  return process.env.LEMON_AUTH_ISSUER || DEFAULT_ISSUER;
}

export function clientId(): string {
  return requiredEnv("LEMON_AUTH_CLIENT_ID");
}

export function keepsAccessToken(): boolean {
  return process.env.LEMON_AUTH_KEEP_ACCESS_TOKEN === "true";
}

/** preview 배포가 redirect_uri 로 쓰는 운영 배포의 콜백 주소 */
export function redirectProxyUrl(): URL | null {
  const value = process.env.LEMON_AUTH_REDIRECT_PROXY_URL;
  return value ? new URL(value) : null;
}

/** 운영 콜백이 code 를 넘겨도 되는 preview origin. 예: `https://haruna-git-*-lemondouble.vercel.app` */
export function previewOriginPattern(): string | undefined {
  return process.env.LEMON_AUTH_PREVIEW_ORIGIN || undefined;
}

let oidcConfiguration: Promise<client.Configuration> | undefined;

/** Discovery 결과를 인스턴스가 살아 있는 동안 재사용한다. 실패하면 다음 요청에서 다시 받는다. */
export function getOidcConfiguration(): Promise<client.Configuration> {
  oidcConfiguration ??= discover().catch((error: unknown) => {
    oidcConfiguration = undefined;
    throw error;
  });
  return oidcConfiguration;
}

async function discover(): Promise<client.Configuration> {
  const issuer = new URL(issuerUrl());
  // http 는 로컬 auth 서버로 검증할 때만 허용한다.
  const execute = isLoopback(issuer) ? [client.allowInsecureRequests] : [];
  return client.discovery(
    issuer,
    clientId(),
    undefined,
    client.ClientSecretBasic(requiredEnv("LEMON_AUTH_CLIENT_SECRET")),
    { execute }
  );
}

function isLoopback(url: URL): boolean {
  return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}
