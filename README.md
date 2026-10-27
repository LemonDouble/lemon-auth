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
| `@lemondouble/lemon-auth/client` | Client Components | 로그인/로그아웃, 토큰 갱신 |
| `@lemondouble/lemon-auth/proxy` | `proxy.ts` | 쿠키 기반 optimistic check |

## 인증 흐름

- 로그인하면 auth 서버가 `.lemondouble.com` 도메인에 `lemon_access_token`(30분)과 `lemon_refresh_token`(30일) 쿠키를 설정합니다.
- 프록시는 쿠키의 `exp`만 보고 라우팅합니다. access token이 만료됐고 refresh token이 남아 있으면 복구 화면을 바로 응답합니다.
- 복구 화면이 브라우저에서 갱신한 뒤 같은 주소를 새로고침합니다. 화면은 [lemon-design-system](https://github.com/LemonDouble/lemon-design-system)의 엠블럼과 스피너로 구성됩니다.
- auth 서버에 연결하지 못하면 "다시 시도" 버튼을 보여줍니다. 401·403이면 세션이 끝난 것이므로 새로고침해서 로그인으로 보냅니다.
- 서명 검증과 승인 판단은 DAL(`getUser` / `getSession` / `requireClient`)이 합니다. 권한 판단은 반드시 DAL에서 합니다.
- CLI처럼 쿠키가 없는 클라이언트는 `Authorization: Bearer <access token>` 헤더로 보냅니다. 토큰은 auth 서버의 [Device Authorization Grant (RFC 8628)](https://www.rfc-editor.org/rfc/rfc8628)로 받습니다. 쿠키가 있으면 쿠키를 우선합니다.

---

## Server — `@lemondouble/lemon-auth/server`

### `getUser()`

쿠키의 `lemon_access_token`(없으면 Bearer 헤더)을 JWKS(ES256)로 검증하고 `LemonUser | null`을 반환합니다. React `cache()`로 감싸져 있어 같은 요청 안에서는 한 번만 검증합니다.

토큰은 [RFC 9068](https://www.rfc-editor.org/rfc/rfc9068) 형식이며, `iss`와 헤더의 `typ: at+jwt`를 검증합니다. `approvedClients`는 토큰의 `aud`에서 auth 서버 주소를 뺀 값입니다.

JWKS는 인스턴스마다 24시간 캐시합니다. 새 키(`kid`)는 바로 다시 받지만, auth 서버에서 폐기한 키는 사용처 앱을 재배포해야 바로 반영됩니다.

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

요청은 위에서부터 순서대로 판정됩니다.

1. PWA·정적 리소스(`/sw.js`, `/manifest.webmanifest`, `/icons/*` 등) → 통과
2. access token 만료까지 60초 이상 → 통과
3. `Authorization: Bearer` 헤더 있음 → 통과 (DAL이 검증)
4. `apiPaths` → 공개 경로면 통과, 아니면 401
5. 비-GET 요청(서버 액션 등) → 통과 (DAL이 거부)
6. refresh token 있음 → 복구 화면 응답 (공개 경로 포함)
7. 공개 경로 → 통과
8. 나머지 → 로그인 페이지 (로그인하면 원래 주소로 돌아옴)

앱 안에서 링크로 이동할 때(소프트 내비게이션)도 복구 화면을 받으면, Next 라우터가 같은 주소로 전체 페이지 이동을 해서 복구가 이어집니다.

---

## Client — `@lemondouble/lemon-auth/client`

| API | 설명 |
|-----|------|
| `loginUrl(redirectUrl)` | Google 로그인 URL을 만듭니다. `redirectUrl`은 `https://` + `*.lemondouble.com`만 허용하며, 아니면 throw합니다 |
| `profileUrl(redirectUrl?)` | auth 서버 프로필 편집 페이지 URL을 만듭니다 |
| `logout()` | refresh token을 폐기하고 쿠키를 지웁니다. 성공 여부를 `boolean`으로 반환합니다 |
| `refreshToken()` | 즉시 갱신합니다. 승인 직후 새 승인 목록(`aud`)을 반영할 때 씁니다 |

---

## 0.12.x → 0.13.0 마이그레이션

- auth 서버가 발급하는 access token 형식이 [RFC 9068](https://www.rfc-editor.org/rfc/rfc9068)로 바뀌었습니다 (`typ: at+jwt`, `aud`에 승인 목록, `approved_clients`·`token_type` 제거). 0.13.0은 새 형식만 받고, 0.12.x는 새 형식을 받지 못하므로 auth 서버 배포 직후 버전을 올립니다.
- 앱 코드는 바꿀 필요가 없습니다. `LemonUser`와 mock user 형식은 그대로입니다.

## 0.11.x → 0.12.0 마이그레이션

- `AuthProvider`와 `useAuth`를 제거했습니다. 레이아웃의 `<AuthProvider>`를 지웁니다. user가 필요하면 Server Component에서 `getUser()`를 호출합니다.
- `createAuthProxy`의 `loginRedirectUrl` 옵션을 제거했습니다. 프록시는 항상 원래 주소로 돌아오게 하므로 `proxy.ts`에서 이 줄을 지웁니다.

---

## 연동 예시

### `proxy.ts`

```ts
import { createAuthProxy } from "@lemondouble/lemon-auth/proxy";

export default createAuthProxy({
  publicPaths: ["/", "/pending-approval", "/api/public/*"],
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|sw.js|manifest.webmanifest|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|woff|woff2|ttf|eot|otf)$).*)",
  ],
};
```

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

레이아웃은 소프트 내비게이션에서 다시 렌더되지 않으므로, 접근 제어는 레이아웃이 아니라 페이지에서 합니다.

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

- 다섯 필드를 모두 camelCase로 적어야 합니다. 하나라도 빠지거나 형식이 다르면 에러가 납니다.
- 서버 API는 mock user를 로그인 유저로 반환합니다. `approvedClients`의 `"*"`는 모든 `clientId`를 승인합니다.
- 프록시는 모든 요청을 통과시킵니다.
- `loginUrl()`은 인자를, `profileUrl()`은 인자(없으면 `"/"`)를 그대로 반환하고, `logout()`·`refreshToken()`은 no-op 후 `true`를 반환합니다.
