# @lemondouble/lemon-auth

`auth.lemondouble.com`(OpenID Connect Provider)으로 로그인하는 Next.js 16+ 앱용 라이브러리입니다. 프로토콜 처리(PKCE, state, nonce, ID Token 검증, Discovery)는 [openid-client](https://github.com/panva/openid-client)가 맡습니다.

- 앱 서버가 confidential client로 Authorization Code Flow를 수행합니다. 브라우저에는 토큰을 주지 않습니다.
- 세션은 앱 도메인 전용 암호화 쿠키 `__Host-lemon_auth`(JWE `dir` + `A256GCM`)에 둡니다. 별도 저장소가 필요 없어 Vercel에서 그대로 동작합니다.
- access token이 만료되기 직전에 proxy가 refresh로 갱신합니다. 로그아웃, 기기 해제, 계정 잠금, 승인 취소는 이 갱신 때(최대 30분) 반영됩니다.

## 설치

```bash
pnpm add @lemondouble/lemon-auth
```

## 연동

### 1. auth 서버에 client 등록

관리 화면에서 앱의 client를 confidential로 만들고 secret을 발급합니다. 등록할 주소는 운영 배포 기준 두 개입니다.

| 종류 | 주소 |
|------|------|
| 로그인 (redirect URI) | `https://<도메인>/auth/callback` |
| 로그아웃 후 | `https://<도메인>/auth/logged-out` |

### 2. 환경변수

| 이름 | 필수 | 설명 |
|------|------|------|
| `LEMON_AUTH_CLIENT_ID` | O | client ID |
| `LEMON_AUTH_CLIENT_SECRET` | O | client secret |
| `LEMON_AUTH_SECRET` | O | 쿠키 암호화 키. 32바이트 base64 (`openssl rand -base64 32`). 바꾸면 모든 앱 세션이 끝나지만, auth 서버 세션이 살아 있으면 화면 없이 다시 로그인됩니다. |
| `LEMON_AUTH_REDIRECT_PROXY_URL` | preview | 운영 배포의 콜백 주소. [preview 배포에서 로그인](#preview-배포에서-로그인) 참고 |
| `LEMON_AUTH_PREVIEW_ORIGIN` | preview | 운영 콜백이 code를 넘겨도 되는 preview origin 패턴 |
| `LEMON_AUTH_KEEP_ACCESS_TOKEN` | | `true`면 세션에 access token도 담아 `getAccessToken()`으로 꺼낼 수 있습니다. |
| `LEMON_AUTH_ISSUER` | | 기본값 `https://auth.lemondouble.com`. 스테이징이나 로컬 auth 서버로 검증할 때만 바꿉니다 (`http`는 `localhost`만 허용). |
| `LEMON_AUTH_MOCK` | | [로컬 개발 (mock)](#로컬-개발-mock) 참고 |

Vercel에서는 Production과 Preview에 같은 값을 넣습니다.

### 3. 인증 경로

```ts
// app/auth/[...lemon]/route.ts
export { GET, POST } from "@lemondouble/lemon-auth/routes";
```

| 경로 | 동작 |
|------|------|
| `GET /auth/login?next=` | auth 서버의 authorize로 보냅니다. |
| `GET /auth/callback` | code를 교환해 세션 쿠키를 만들고 `next`로 보냅니다. 오류를 받으면 종류와 관계없이 세션 없이 `/`로 보냅니다 (오류 화면은 auth 서버가 이미 보여 줌). |
| `POST /auth/logout` | 세션을 지우고 auth 서버 로그아웃([RP-Initiated Logout](https://openid.net/specs/openid-connect-rpinitiated-1_0.html))으로 보냅니다. 같은 브라우저의 다른 앱도 다음 갱신 때 로그아웃됩니다. 다른 사이트가 몰래 로그아웃시키지 못하게, 앱 자신의 화면에서 보낸 요청(Origin 확인)만 받습니다. |
| `GET /auth/logged-out` | 로그아웃 후 돌아오는 곳. `/`로 보냅니다. |
| `GET /auth/profile?next=` | auth 서버의 프로필 화면으로 보냅니다. |
| `GET /auth/profile-return?next=` | 프로필 화면에서 돌아오는 곳. 그 자리에서 갱신해 바뀐 프로필을 반영한 뒤 `next`로 보냅니다. |

`next`는 앱 안의 경로(`/`로 시작)만 받고, 아니면 `/`로 바꿉니다.

### 4. proxy

```ts
// proxy.ts
import { createAuthProxy } from "@lemondouble/lemon-auth/proxy";

export default createAuthProxy({ publicPaths: ["/", "/s/*"] });

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico|woff2)$).*)"],
};
```

| 옵션 | 기본값 | 설명 |
|------|--------|------|
| `publicPaths` | `[]` | 로그인 없이 열어 둘 경로. `*`로 끝나면 prefix 매칭 |
| `apiPaths` | `["/api/*"]` | 세션이 없으면 로그인으로 보내는 대신 `401 { "code": "UNAUTHORIZED" }`를 돌려줄 경로 |

- `/auth/*`, PWA와 정적 파일, `Authorization: Bearer` 요청은 그대로 통과합니다.
- access token 만료 60초 전부터 refresh로 갱신하고, 갱신한 세션을 이번 요청의 페이지에도 넘깁니다.
- auth 서버가 갱신을 거절하면 세션을 지웁니다. auth 서버에 닿지 못하면 세션을 두고 만료 전까지 그대로 씁니다.
- 세션이 없으면 보호한 화면은 `/auth/login?next=<지금 주소>`로 보내고, `apiPaths`는 401로 응답합니다. GET이 아닌 요청(서버 액션)은 페이지 쪽 확인에 맡깁니다.
- proxy는 경로만 나눕니다. 권한 판단은 반드시 각 페이지, Route Handler, 서버 액션에서 아래 서버 함수로 합니다. 레이아웃은 소프트 내비게이션에서 다시 렌더되지 않으므로 페이지에서 확인합니다.

## Server — `@lemondouble/lemon-auth/server`

| API | 설명 |
|-----|------|
| `getSession()` | `{ type: "none" }` 또는 `{ type: "authenticated", user }`. access token이 만료된 세션은 `none`입니다. |
| `requireSession(next = "/")` | 세션이 없으면 `/auth/login?next=`로 보내고, 있으면 `LemonUser`를 돌려줍니다. |
| `requireAdmin(next = "/")` | `requireSession()`에 더해, 관리자가 아니면 `notFound()`(404)로 응답합니다. [`forbidden()`](https://nextjs.org/docs/app/api-reference/functions/forbidden)은 아직 실험 기능이라 쓰지 않습니다. |
| `verifyBearerToken(request)` | `Authorization: Bearer` access token을 [RFC 9068](https://www.rfc-editor.org/rfc/rfc9068) 규칙(`typ: at+jwt`, `iss`, `aud`에 이 앱의 client ID, `exp`, RS256 서명)으로 검증합니다. 실패하면 `null`입니다. |
| `getAccessToken()` | `{ value, expiresAt }` 또는 `null`. `LEMON_AUTH_KEEP_ACCESS_TOKEN=true`인 앱만 쓸 수 있습니다. |
| `loginUrl()`, `logoutUrl()`, `profileUrl()` | Client와 같습니다. |

```ts
interface LemonUser {
  sub: string;
  name: string;
  picture: string | null;
  email: string | null;
  groups: string[];
  isAdmin: boolean; // groups 에 admin 이 있음. MFA 를 거친 관리자 로그인에서만 true
  updatedAt: number; // 프로필을 마지막으로 바꾼 시각(초). 앱의 프로필 복사본을 갱신할 때 비교
}

interface BearerToken {
  sub: string;
  clientId: string; // 토큰을 받은 프로그램 (예: lemon-cli)
  scope: string[];
  groups: string[];
  isAdmin: boolean;
}
```

- 사용자 정보는 세션의 ID Token에서 읽습니다. 프로필은 갱신 때 받는 새 ID Token으로 바뀝니다 (`/auth/profile-return`을 거치면 바로).
- Bearer 토큰에는 프로필이 없습니다. 다른 프로그램이 앱 API를 부르려면, auth 서버에서 그 프로그램 client의 추가 대상(`client_audience`)에 이 앱을 넣어야 합니다.

```tsx
import { requireSession } from "@lemondouble/lemon-auth/server";

export default async function MyPage() {
  const user = await requireSession("/my");
  return <h1>{user.name}</h1>;
}
```

### 브라우저가 다른 API 서버를 직접 부를 때

[Token-Mediating Backend](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-browser-based-apps#section-6.2) 방식입니다. refresh token은 서버 쿠키에만 있고, 브라우저는 짧은 access token만 메모리에 둡니다.

```ts
// app/api/access-token/route.ts
import { getAccessToken } from "@lemondouble/lemon-auth/server";

export async function GET() {
  const token = await getAccessToken();
  if (!token) return Response.json({ code: "UNAUTHORIZED" }, { status: 401 });
  return Response.json(token, { headers: { "Cache-Control": "no-store" } });
}
```

## Client — `@lemondouble/lemon-auth/client`

앱 자신의 `/auth/*` 경로를 만듭니다.

| API | 결과 |
|-----|------|
| `loginUrl(next = "/")` | `/auth/login?next=...` |
| `logoutUrl()` | `/auth/logout`. POST로만 받으므로 form으로 보냅니다. |
| `profileUrl(next = "/")` | `/auth/profile?next=...` |

```tsx
import { loginUrl, logoutUrl } from "@lemondouble/lemon-auth/client";

<a href={loginUrl("/upload")}>로그인</a>

<form method="post" action={logoutUrl()}>
  <button>로그아웃</button>
</form>
```

## preview 배포에서 로그인

preview 주소는 배포마다 바뀌어 redirect URI로 등록할 수 없습니다. 그래서 운영 배포의 `/auth/callback`이 code를 preview로 넘깁니다.

1. preview가 로그인을 시작하면 redirect URI로 운영 콜백을 보내고, state에 자기 origin을 서명해 담습니다 (`LEMON_AUTH_SECRET`에서 나눈 키).
2. 운영 콜백은 서명을 확인하고, origin이 `LEMON_AUTH_PREVIEW_ORIGIN` 패턴에 맞을 때만 query를 그대로 붙여 preview의 `/auth/callback`으로 보냅니다.
3. preview는 운영 콜백 주소를 redirect URI로 써서 code를 교환합니다. PKCE verifier는 preview 브라우저의 임시 쿠키에 있으므로, 넘긴 code는 다른 곳에서 쓸 수 없습니다.

| 환경변수 | 예시 |
|------|------|
| `LEMON_AUTH_REDIRECT_PROXY_URL` | `https://haruna.lemondouble.com/auth/callback` |
| `LEMON_AUTH_PREVIEW_ORIGIN` | `https://haruna-git-*-<팀>.vercel.app` ([Vercel: Generated URLs](https://vercel.com/docs/deployments/generated-urls)) |

- `*`는 영문 소문자, 숫자, `-`로 된 한 부분에만 맞습니다. 패턴을 넣지 않으면 운영 콜백은 어떤 preview로도 넘기지 않습니다.
- preview에서는 프로필 화면에서 앱으로 돌아오는 기능을 쓸 수 없습니다 (auth 서버는 등록된 origin으로만 돌려보냄).
- [Vercel Deployment Protection](https://vercel.com/docs/deployment-protection)을 켜 두면 외부인이 preview에 접근할 수 없습니다.

## 로컬 개발 (mock)

confidential client는 `http://localhost`를 redirect URI로 쓸 수 없으므로, 로컬에서는 가짜 사용자로 동작합니다. `.env.local`에 설정하며, production 빌드에서는 무시됩니다.

```bash
LEMON_AUTH_MOCK='{"sub":"local-user","name":"Local User","groups":["admin"]}'
```

- `sub`, `name`은 필수이고 `picture`, `email`, `groups`, `updatedAt`은 선택입니다.
- 서버 함수는 이 사용자를 로그인 사용자로 돌려주고, proxy는 모든 요청을 통과시킵니다. `/auth/login`, `/auth/profile`은 `next`로, `/auth/logout`은 `/`로 바로 보냅니다.

## 0.13.x → 1.0.0

auth 서버의 OIDC 전환과 함께 올립니다. 0.x는 `.lemondouble.com` 공유 쿠키를 읽었고, 1.0은 앱마다 자기 세션을 가집니다.

- `app/auth/[...lemon]/route.ts`를 추가하고, 환경변수를 `LEMON_AUTH_*`로 바꿉니다.
- `getSession({ clientId })` → `getSession()`. 승인 대기는 auth 서버가 처리해서 승인되지 않은 사용자에게는 세션이 생기지 않으므로 `unapproved`를 없앴습니다. `requireClient()` → `requireSession()`이고, `getUser()`는 없앴습니다.
- `LemonUser`: `uid` → `sub`, `nickname` → `name`, `profileImageUrl` → `picture`, `role === "admin"` → `isAdmin`. `approvedClients`는 없앴습니다.
- Client: `loginUrl(절대 주소)` → `loginUrl(앱 경로)`, `logout()` → `logoutUrl()`로 form POST. `refreshToken()`은 없앴습니다.
- Bearer 요청은 `getSession()`이 아니라 `verifyBearerToken(request)`로 확인합니다.
- mock: `NEXT_PUBLIC_LEMON_AUTH_MOCK_USER` → `LEMON_AUTH_MOCK` (형식도 바뀜).

## 개발

```bash
pnpm install
pnpm run typecheck
pnpm run test   # 가짜 OP를 붙여 openid-client의 검증까지 그대로 돌립니다
pnpm run build
```
