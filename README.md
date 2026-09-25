# @lemondouble/lemon-auth

`*.lemondouble.com` 서비스를 위한 인증 라이브러리입니다. Next.js 16+ 전용입니다.

`auth.lemondouble.com` 인증 서버와 연동하여 JWT 검증, 토큰 갱신, 로그인/로그아웃을 처리합니다.

## 설치

```bash
pnpm add @lemondouble/lemon-auth
```

## 엔트리포인트

| 경로 | 환경 | 용도 |
|------|------|------|
| `@lemondouble/lemon-auth/server` | Server Components, Route Handlers, Server Actions | 유저 조회, 승인 체크, URL 헬퍼 |
| `@lemondouble/lemon-auth/client` | Client Components | AuthProvider, 세션 복구, 로그인/로그아웃 |
| `@lemondouble/lemon-auth/proxy` | `proxy.ts` | 쿠키 기반 optimistic check |

## 인증 흐름

- 로그인하면 auth 서버가 `.lemondouble.com` 도메인에 `lemon_access_token`(30분)과 `lemon_refresh_token`(30일) 쿠키를 설정합니다.
- 프록시는 쿠키의 `exp`만 보고 라우팅합니다. access token이 만료됐고 refresh token이 남아 있으면 `/auth/restore`로 보냅니다.
- `/auth/restore`의 `<SessionRestore />`가 브라우저에서 갱신한 뒤 원래 경로로 돌아갑니다.
- 서명 검증과 승인 판단은 DAL(`getUser` / `getSession` / `requireClient`)이 합니다. 권한 판단은 반드시 DAL에서 합니다.

---

## Server — `@lemondouble/lemon-auth/server`

### `getUser()`

쿠키의 `lemon_access_token`을 JWKS(ES256)로 검증하고 `LemonUser | null`을 반환합니다. React `cache()`로 감싸져 있어 같은 요청 안에서는 한 번만 검증합니다.

```ts
interface LemonUser {
  uid: string;
  nickname: string;
  profileImageUrl: string;
  role: "user" | "admin";
  approvedClients: string[];
}
```

### `getSession({ clientId })`

로그인 상태와 클라이언트 승인 상태를 함께 반환합니다. `clientId`가 빈 값(환경변수 누락 등)이면 모든 유저가 `unapproved`가 됩니다. 승인 없이 로그인 여부만 필요하면 `getUser()`를 씁니다.

```ts
const session = await getSession({ clientId: process.env.CLIENT_ID! });
// { type: "none" } | { type: "unapproved"; user } | { type: "authenticated"; user }
```

### `requireClient(clientId, options?)`

승인된 유저만 반환하고, 아니면 redirect합니다.

| 옵션 | 기본값 | 설명 |
|------|--------|------|
| `loginRedirectTo` | `"/"` | 미로그인 시 redirect 경로 |
| `unapprovedRedirectTo` | auth 서버 `/error?code=FORBIDDEN` | 미승인 시 redirect 경로 |

### `loginUrl()` / `profileUrl()`

Client 엔트리포인트의 같은 함수를 Server Component에서 쓸 수 있게 re-export합니다.

---

## Proxy — `@lemondouble/lemon-auth/proxy`

### `createAuthProxy(options?)`

| 옵션 | 기본값 | 설명 |
|------|--------|------|
| `publicPaths` | `[]` | 로그인 없이 열어둘 경로. `*`로 끝나면 prefix 매칭 |
| `apiPaths` | `["/api/*"]` | 인증 실패 시 redirect 대신 `401 { "code": "UNAUTHORIZED" }`를 반환할 경로 |
| `loginRedirectUrl` | `undefined` | 로그인 후 돌아올 URL. 문자열 또는 `(request) => string`. 미설정 시 `"/"`로 redirect |

요청은 위에서부터 순서대로 판정됩니다.

1. `/auth/restore` → 통과
2. PWA·정적 리소스(`/sw.js`, `/manifest.webmanifest`, `/icons/*` 등) → 통과
3. access token 만료까지 60초 이상 → 통과
4. `apiPaths` → 공개 경로면 통과, 아니면 401
5. 비-GET 요청(서버 액션 등) → 통과 (DAL이 거부)
6. refresh token 있음 → `/auth/restore?next=<원래 경로>` (공개 경로 포함)
7. 공개 경로 → 통과
8. 나머지 → 로그인 페이지

### 0.9.x → 0.10.0 마이그레이션

쓰이지 않던 API를 정리했습니다.

- 제거: `requireAuth`, `verifyAccessToken`, `verifyAccessTokenString`, `/server`의 URL·쿠키 상수, `AccessTokenClaims`·`UserProfile` 타입
- 제거: proxy의 `bypassPaths`·`restorePath` 옵션, `DEFAULT_AUTH_BYPASS_PATHS`·`DEFAULT_RESTORE_PATH`·`PROXY_AUTH_ERROR`
- `getSession()`의 `clientId`가 필수가 됐습니다. 빈 값이면 승인 검사를 건너뛰던(fail-open) 동작이 `unapproved`로 바뀝니다.
- `requireClient()`의 두 번째 인자는 옵션 객체만 받습니다.
- `LOGIN_URL`·`PROFILE_PAGE_URL`로 URL을 직접 만들던 곳은 `/server`에서 `loginUrl()`·`profileUrl()`을 import해 씁니다.

---

## Client — `@lemondouble/lemon-auth/client`

| API | 설명 |
|-----|------|
| `<AuthProvider user>` / `useAuth()` | Server Component에서 받은 `user`를 Client Component에 전달합니다. `useAuth()`는 `{ user, isAuthenticated }`를 반환합니다 |
| `<SessionRestore fallback>` | `/auth/restore`에 마운트하는 세션 복구 컴포넌트입니다. 서버에 연결하지 못하면 "다시 시도" 버튼을 보여줍니다 |
| `loginUrl(redirectUrl)` | Google 로그인 URL을 만듭니다. `redirectUrl`은 `https://` + `*.lemondouble.com`만 허용하며, 아니면 throw합니다 |
| `profileUrl(redirectUrl?)` | auth 서버 프로필 편집 페이지 URL을 만듭니다 |
| `logout()` | refresh token을 폐기하고 쿠키를 지웁니다. 성공 여부를 `boolean`으로 반환합니다 |
| `refreshToken()` | 즉시 갱신합니다. 승인 직후 새 `approved_clients`를 반영할 때 씁니다 |

---

## 연동 예시

### `proxy.ts`

```ts
import { createAuthProxy } from "@lemondouble/lemon-auth/proxy";

export default createAuthProxy({
  publicPaths: ["/", "/pending-approval", "/api/public/*"],
  loginRedirectUrl: (request) => request.url,
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|sw.js|manifest.webmanifest|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|woff|woff2|ttf|eot|otf)$).*)",
  ],
};
```

### `app/auth/restore/page.tsx`

```tsx
import { Suspense } from "react";
import { SessionRestore } from "@lemondouble/lemon-auth/client";

export const dynamic = "force-dynamic";

export default function RestorePage() {
  return (
    <Suspense fallback={null}>
      <SessionRestore fallback={<p>세션 복원 중...</p>} />
    </Suspense>
  );
}
```

`useSearchParams()`를 쓰므로 `<Suspense>`로 감싸야 빌드가 통과합니다.

### `app/layout.tsx`

```tsx
import { getUser } from "@lemondouble/lemon-auth/server";
import { AuthProvider } from "@lemondouble/lemon-auth/client";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  return (
    <html lang="ko">
      <body>
        <AuthProvider user={user}>{children}</AuthProvider>
      </body>
    </html>
  );
}
```

레이아웃은 소프트 네비게이션에서 다시 렌더되지 않으므로 `user`를 표시용으로만 씁니다. 접근 제어는 페이지에서 합니다.

### 보호 페이지

```tsx
import { requireClient } from "@lemondouble/lemon-auth/server";

export default async function Dashboard() {
  const user = await requireClient(process.env.CLIENT_ID!, {
    unapprovedRedirectTo: "/pending-approval",
  });
  return <h1>{user.nickname}님의 대시보드</h1>;
}
```

### 로그인 · 로그아웃 버튼

```tsx
"use client";
import { loginUrl, logout } from "@lemondouble/lemon-auth/client";

export function LoginButton() {
  return <a href={loginUrl("https://myapp.lemondouble.com/dashboard")}>Google로 로그인</a>;
}

export function LogoutButton() {
  return (
    <button
      onClick={async () => {
        await logout();
        window.location.href = "/";
      }}
    >
      로그아웃
    </button>
  );
}
```

---

## 로컬 개발 Mock User

auth 서버 없이 로그인 상태를 재현하려면 `.env.local`에 설정합니다. `NODE_ENV === "production"`에서는 무시됩니다.

```bash
NEXT_PUBLIC_LEMON_AUTH_MOCK_USER='{"uid":"local-user","nickname":"Local User","profileImageUrl":"","role":"admin","approvedClients":["*"]}'
```

- 서버 API는 mock user를 로그인 유저로 반환합니다. `approvedClients`의 `"*"`는 모든 `clientId`를 승인합니다.
- 프록시는 모든 요청을 통과시킵니다.
- `loginUrl()`은 인자를, `profileUrl()`은 인자(없으면 `"/"`)를 그대로 반환하고, `logout()`·`refreshToken()`은 no-op 후 `true`를 반환합니다.
