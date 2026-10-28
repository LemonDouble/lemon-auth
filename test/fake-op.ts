import * as client from "openid-client";
import { SignJWT, calculateJwkThumbprint, exportJWK, generateKeyPair } from "jose";

export const ISSUER = "https://op.test";
export const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
export const CLIENT_SECRET = "lcs_test-secret";
export const OTHER_CLIENT_ID = "22222222-2222-4222-8222-222222222222";

export interface FakeUser {
  sub: string;
  name: string;
  groups: string[];
}

interface PendingCode {
  user: FakeUser;
  nonce: string;
  codeChallenge: string;
  redirectUri: string;
}

/** 토큰 엔드포인트와 JWKS 만 흉내 낸다. openid-client 의 검증 코드는 그대로 돈다. */
export async function createFakeOp() {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  const kid = await calculateJwkThumbprint(publicJwk);
  const codes = new Map<string, PendingCode>();
  const refreshTokens = new Map<string, FakeUser>();
  const state = { unreachable: false, profileName: undefined as string | undefined, clientLookups: 0 };

  const metadata: client.ServerMetadata = {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/oauth/authorize`,
    token_endpoint: `${ISSUER}/oauth/token`,
    jwks_uri: `${ISSUER}/.well-known/jwks.json`,
    end_session_endpoint: `${ISSUER}/oauth/logout`,
    authorization_response_iss_parameter_supported: true,
    id_token_signing_alg_values_supported: ["RS256"],
  };

  async function signAccessToken(user: FakeUser, overrides: { aud?: string[]; typ?: string; exp?: number; clientId?: string } = {}) {
    return new SignJWT({ client_id: overrides.clientId ?? CLIENT_ID, scope: "openid profile email", groups: user.groups })
      .setProtectedHeader({ alg: "RS256", kid, typ: overrides.typ ?? "at+jwt" })
      .setIssuer(ISSUER)
      .setSubject(user.sub)
      .setAudience(overrides.aud ?? [CLIENT_ID])
      .setIssuedAt()
      .setExpirationTime(overrides.exp ?? "30m")
      .sign(privateKey);
  }

  async function issueTokens(user: FakeUser, nonce?: string) {
    const idTokenClaims: Record<string, unknown> = {
      name: state.profileName ?? user.name,
      email: `${user.sub}@example.com`,
      groups: user.groups,
      updated_at: state.profileName ? 2000 : 1000,
      auth_time: Math.floor(Date.now() / 1000),
      sid: "session-1",
    };
    if (nonce) idTokenClaims.nonce = nonce;
    const idToken = await new SignJWT(idTokenClaims)
      .setProtectedHeader({ alg: "RS256", kid, typ: "JWT" })
      .setIssuer(ISSUER)
      .setSubject(user.sub)
      .setAudience(CLIENT_ID)
      .setIssuedAt()
      .setExpirationTime("30m")
      .sign(privateKey);
    return { access_token: await signAccessToken(user), token_type: "Bearer", expires_in: 1800, id_token: idToken };
  }

  async function handleToken(request: Request): Promise<Response> {
    // Basic 의 id 와 secret 은 form-urlencoded 로 인코딩되어 온다 (RFC 6749 §2.3.1).
    const basic = atob(request.headers.get("authorization")?.replace(/^Basic /, "") ?? "");
    const [id, secret] = basic.split(":").map((part) => decodeURIComponent(part.replace(/\+/g, " ")));
    if (id !== CLIENT_ID || secret !== CLIENT_SECRET) {
      return Response.json({ error: "invalid_client" }, { status: 401 });
    }
    const form = new URLSearchParams(await request.text());

    if (form.get("grant_type") === "authorization_code") {
      const pending = codes.get(form.get("code") ?? "");
      codes.delete(form.get("code") ?? "");
      const challenge = await client.calculatePKCECodeChallenge(form.get("code_verifier") ?? "");
      if (!pending || pending.codeChallenge !== challenge || pending.redirectUri !== form.get("redirect_uri")) {
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      const refreshToken = client.randomState();
      refreshTokens.set(refreshToken, pending.user);
      return Response.json({ ...(await issueTokens(pending.user, pending.nonce)), refresh_token: refreshToken });
    }

    if (form.get("grant_type") === "refresh_token") {
      const user = refreshTokens.get(form.get("refresh_token") ?? "");
      if (!user) return Response.json({ error: "invalid_grant" }, { status: 400 });
      return Response.json(await issueTokens(user));
    }
    return Response.json({ error: "unsupported_grant_type" }, { status: 400 });
  }

  // auth 서버의 client 조회 API. 등록된 client 의 Basic 인증이 있어야 한다.
  function handleClientLookup(request: Request, url: URL): Response {
    state.clientLookups += 1;
    if (request.headers.get("authorization") !== "Basic " + btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)) {
      return Response.json({ error: "invalid_client" }, { status: 401 });
    }
    if (url.pathname !== `/api/clients/${OTHER_CLIENT_ID}`) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ client_id: OTHER_CLIENT_ID, name: "nightly-backup", icon_url: `${ISSUER}/public/lemon-logo.webp` });
  }

  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (state.unreachable) throw new TypeError("fetch failed");
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.href === metadata.jwks_uri) {
      return Response.json({ keys: [{ ...publicJwk, kid, alg: "RS256", use: "sig" }] });
    }
    if (url.href === metadata.token_endpoint) return handleToken(request);
    if (url.pathname.startsWith("/api/clients/")) return handleClientLookup(request, url);
    return new Response("not found", { status: 404 });
  };

  const configuration = new client.Configuration(metadata, CLIENT_ID, undefined, client.ClientSecretBasic(CLIENT_SECRET));
  configuration[client.customFetch] = (url, options) => fetch(url, options as RequestInit);

  return {
    configuration,
    fetch,
    state,
    signAccessToken,
    /** 사용자가 OP 에서 로그인을 마친 것처럼 code 를 만들어 콜백 주소를 돌려준다. */
    async approve(authorizationUrl: URL, user: FakeUser): Promise<URL> {
      const parameters = authorizationUrl.searchParams;
      const code = client.randomState();
      codes.set(code, {
        user,
        nonce: parameters.get("nonce") ?? "",
        codeChallenge: parameters.get("code_challenge") ?? "",
        redirectUri: parameters.get("redirect_uri") ?? "",
      });
      const callback = new URL(parameters.get("redirect_uri") ?? "");
      callback.searchParams.set("code", code);
      callback.searchParams.set("state", parameters.get("state") ?? "");
      callback.searchParams.set("iss", ISSUER);
      return callback;
    },
    /** 로그아웃, 기기 해제처럼 OP 가 세션을 끝낸 상태 */
    endAllSessions() {
      refreshTokens.clear();
    },
  };
}

export type FakeOp = Awaited<ReturnType<typeof createFakeOp>>;
