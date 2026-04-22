# @lemondouble/lemon-auth

`*.lemondouble.com` 서비스를 위한 인증 라이브러리. Next.js 16+ 전용.

`auth.lemondouble.com` 인증 서버와 연동하여 JWT 검증, 토큰 갱신, 로그인/로그아웃을 처리합니다.

## 설치

```bash
npm install @lemondouble/lemon-auth
```

## 엔트리포인트

| 경로 | 환경 | 용도 |
|------|------|------|
| `@lemondouble/lemon-auth/server` | Server Components, Route Handlers, Server Actions | JWT 검증, 유저 조회, 인증 체크 |
| `@lemondouble/lemon-auth/client` | Client Components | AuthProvider, useAuth 훅, URL 헬퍼 |
| `@lemondouble/lemon-auth/proxy` | proxy.ts | 토큰 자동 갱신 미들웨어 |

## 사용법

### Server

```ts
import {
  getUser,
  requireAuth,
  requireClient,
  verifyAccessToken,
} from "@lemondouble/lemon-auth/server";

// JWT 검증 (쿠키에서 자동으로 읽음)
const claims = await verifyAccessToken();

// 유저 정보 조회 (요청당 1회만 실행, React cache)
const user = await getUser();

// 인증 필수 (미인증 시 redirect)
const user = await requireAuth();        // "/" 로 redirect
const user = await requireAuth("/login"); // "/login" 으로 redirect

// 클라이언트 승인 필수
const user = await requireClient("your-client-uuid");
```

### Proxy (proxy.ts)

```ts
import { createAuthProxy } from "@lemondouble/lemon-auth/proxy";

export default createAuthProxy({
  publicPaths: ["/", "/about"],    // 인증 불필요 경로
  clientId: process.env.CLIENT_ID, // approved_clients 체크 (선택)
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

proxy가 하는 일:
- 보호 경로 접근 시 `access_token` 검증
- 만료 임박(60초 이내) 시 자동으로 토큰 갱신
- 미인증 시 `/` 또는 로그인 페이지로 redirect

### Client

```tsx
// layout.tsx (Server Component)
import { getUser } from "@lemondouble/lemon-auth/server";
import { AuthProvider } from "@lemondouble/lemon-auth/client";

export default async function Layout({ children }) {
  const user = await getUser();
  return <AuthProvider user={user}>{children}</AuthProvider>;
}
```

```tsx
// 아무 Client Component
"use client";
import { useAuth, loginUrl, logout, profileUrl } from "@lemondouble/lemon-auth/client";

function MyComponent() {
  const { user, isAuthenticated } = useAuth();

  return isAuthenticated ? (
    <>
      <span>{user.nickname}</span>
      <a href={profileUrl("https://myapp.lemondouble.com")}>프로필 편집</a>
      <button onClick={() => logout()}>로그아웃</button>
    </>
  ) : (
    <a href={loginUrl("https://myapp.lemondouble.com/callback")}>로그인</a>
  );
}
```

## 타입

```ts
interface LemonUser {
  uid: string;
  nickname: string;
  profileImageUrl: string;
  role: "user" | "admin";
  approvedClients: string[];
}
```
