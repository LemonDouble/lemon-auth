# @lemondouble/lemon-auth

`*.lemondouble.com` 서비스를 위한 인증 라이브러리. Next.js 16+ 전용.

`auth.lemondouble.com` 인증 서버와 연동하여 JWT 검증, 토큰 갱신, 로그인/로그아웃을 처리합니다.

## 설치

```bash
pnpm add @lemondouble/lemon-auth
```

## 엔트리포인트

| 경로 | 환경 | 용도 |
|------|------|------|
| `@lemondouble/lemon-auth/server` | Server Components, Route Handlers, Server Actions | JWT 검증, 유저 조회, 인증 체크 |
| `@lemondouble/lemon-auth/client` | Client Components | AuthProvider, useAuth 훅, URL 헬퍼 |
| `@lemondouble/lemon-auth/proxy` | proxy.ts | 토큰 자동 갱신 프록시 |

---

## Server — `@lemondouble/lemon-auth/server`

Server Components, Route Handlers, Server Actions에서 사용합니다.

### `verifyAccessToken()`

쿠키에서 `lemon_access_token`을 읽어 JWKS(ES256)로 검증합니다.

```ts
import { verifyAccessToken } from "@lemondouble/lemon-auth/server";

const claims = await verifyAccessToken();
// → AccessTokenClaims | null
```

반환되는 `AccessTokenClaims`:

```ts
interface AccessTokenClaims {
  token_type: "access";     // access token 여부
  sub: string;              // 사용자 UUID
  nickname: string;         // 닉네임
  profile_image_url: string; // 프로필 이미지 URL
  role: "user" | "admin";   // 역할
  approved_clients: string[]; // 승인된 클라이언트 ID 목록
  iss: string;              // issuer (https://auth.lemondouble.com)
  exp: number;              // 만료 시간
  iat: number;              // 발급 시간
}
```

### `verifyAccessTokenString(token)`

토큰 문자열을 직접 전달하여 검증합니다. 쿠키 대신 `Authorization` 헤더 등에서 토큰을 꺼낼 때 사용합니다.

```ts
import { verifyAccessTokenString } from "@lemondouble/lemon-auth/server";

// Route Handler에서 Authorization 헤더 사용 예시
export async function GET(request: Request) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return new Response(null, { status: 401 });

  const claims = await verifyAccessTokenString(token);
  if (!claims) return new Response(null, { status: 401 });

  return Response.json({ userId: claims.sub });
}
```

### `getUser()`

`verifyAccessToken()`을 호출하고 결과를 `LemonUser` 객체로 변환합니다.
React `cache()`로 감싸져 있어서 **같은 요청 내에서 여러 번 호출해도 JWT 검증은 1회만** 실행됩니다.

```ts
import { getUser } from "@lemondouble/lemon-auth/server";

export default async function Page() {
  const user = await getUser();
  // → LemonUser | null

  if (!user) return <p>로그인이 필요합니다</p>;
  return <p>{user.nickname}님 환영합니다</p>;
}
```

반환되는 `LemonUser`:

```ts
interface LemonUser {
  uid: string;              // 사용자 UUID
  nickname: string;         // 닉네임
  profileImageUrl: string;  // 프로필 이미지 URL
  role: "user" | "admin";   // 역할
  approvedClients: string[]; // 승인된 클라이언트 ID 목록
}
```

### `getSession(options?)`

로그인 상태와 클라이언트 승인 상태를 함께 반환합니다.

```ts
import { getSession } from "@lemondouble/lemon-auth/server";

const CLIENT_ID = process.env.CLIENT_ID!;

export default async function Page() {
  const session = await getSession({ clientId: CLIENT_ID });

  if (session.type === "none") return <p>로그인이 필요합니다</p>;
  if (session.type === "unapproved") return <p>관리자 승인이 필요합니다</p>;

  return <p>{session.user.nickname}님 환영합니다</p>;
}
```

반환되는 `LemonSession`:

```ts
type LemonSession =
  | { type: "none" }
  | { type: "unapproved"; user: LemonUser }
  | { type: "authenticated"; user: LemonUser };
```

### `requireAuth(redirectTo?)`

인증된 유저를 반환합니다. 미인증이면 `redirectTo`로 redirect합니다.

```ts
import { requireAuth } from "@lemondouble/lemon-auth/server";

export default async function ProtectedPage() {
  const user = await requireAuth();        // 미인증 시 "/" 로 redirect
  // const user = await requireAuth("/login"); // 미인증 시 "/login" 으로 redirect

  return <p>{user.nickname}님의 대시보드</p>;
}
```

| 파라미터 | 타입 | 기본값 | 설명 |
|---------|------|--------|------|
| `redirectTo` | `string` | `"/"` | 미인증 시 redirect 경로 |

### `requireClient(clientId, options?)`

`requireAuth()` + `approved_clients` 체크. 관리자가 승인한 사용자만 접근할 수 있는 서비스에서 사용합니다.

```ts
import { requireClient } from "@lemondouble/lemon-auth/server";

const CLIENT_ID = process.env.CLIENT_ID!;

export default async function Page() {
  const user = await requireClient(CLIENT_ID, {
    loginRedirectTo: "/",
    unapprovedRedirectTo: "/pending-approval",
  });
  return <p>{user.nickname}</p>;
}
```

| 파라미터 | 타입 | 기본값 | 설명 |
|---------|------|--------|------|
| `clientId` | `string` | (필수) | 체크할 클라이언트 UUID |
| `options.loginRedirectTo` | `string` | `"/"` | 미인증 시 redirect 경로 |
| `options.unapprovedRedirectTo` | `string` | `undefined` | 로그인은 됐지만 클라이언트 미승인 시 redirect 경로. 미설정 시 `Error("Client not approved")` throw |

### `refreshTokenFromCookie(refreshTokenCookie, deviceIdCookie?)`

서버사이드에서 토큰 갱신을 수행합니다. Route Handler 등에서 수동으로 갱신할 때 사용합니다.

```ts
import { refreshTokenFromCookie } from "@lemondouble/lemon-auth/server";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get("lemon_refresh_token")?.value;
  const deviceId = cookieStore.get("device_id")?.value;
  if (!refreshToken) return new Response(null, { status: 401 });

  const result = await refreshTokenFromCookie(refreshToken, deviceId);
  // result: { ok: boolean, setCookieHeaders: string[] }

  if (!result.ok) return new Response(null, { status: 401 });

  const response = new Response(null, { status: 200 });
  for (const header of result.setCookieHeaders) {
    response.headers.append("Set-Cookie", header);
  }
  return response;
}
```

### 상수

서버 엔트리포인트에서 모든 상수를 re-export합니다.

```ts
import {
  AUTH_SERVER_URL,       // "https://auth.lemondouble.com"
  JWKS_URL,              // "https://auth.lemondouble.com/.well-known/jwks.json"
  LOGIN_URL,             // "https://auth.lemondouble.com/api/oauth2/google/login"
  REFRESH_URL,           // "https://auth.lemondouble.com/api/token/refresh"
  LOGOUT_URL,            // "https://auth.lemondouble.com/api/token/logout"
  PROFILE_URL,           // "https://auth.lemondouble.com/api/user/me"
  PROFILE_PAGE_URL,      // "https://auth.lemondouble.com/profile"
  ACCESS_TOKEN_COOKIE,   // "lemon_access_token"
  REFRESH_TOKEN_COOKIE,  // "lemon_refresh_token"
  DEVICE_ID_COOKIE,      // "device_id"
} from "@lemondouble/lemon-auth/server";
```

---

## Proxy — `@lemondouble/lemon-auth/proxy`

Next.js 16의 `proxy.ts`에서 사용합니다. 보호 경로 접근 시 JWT 검증 + 만료 임박 토큰 자동 갱신을 처리합니다.

### `createAuthProxy(options?)`

```ts
// proxy.ts (프로젝트 루트)
import { createAuthProxy } from "@lemondouble/lemon-auth/proxy";

export default createAuthProxy({
  publicPaths: ["/", "/about", "/api/public/*"],
  bypassPaths: ["/workbox-*"],
  clientId: process.env.CLIENT_ID,
  loginRedirectUrl: (request) => request.url,
  unapprovedRedirectUrl: "/pending-approval",
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|sw.js|manifest.webmanifest|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|woff|woff2|ttf|eot|otf)$).*)",
  ],
};
```

#### `AuthProxyOptions`

| 옵션 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `publicPaths` | `string[]` | `[]` | 인증 없이 접근 가능한 경로. `*`로 끝나면 prefix 매칭 (예: `"/api/public/*"`) |
| `bypassPaths` | `string[]` | `[]` | proxy가 refresh도 하지 않고 바로 통과시킬 추가 경로. 기본 PWA 경로(`/sw.js`, `/manifest.webmanifest` 등)는 항상 bypass |
| `apiPaths` | `string[]` | `["/api/*"]` | 보호 API 경로. 인증 실패 시 redirect 대신 JSON 응답을 반환한다. disable하려면 `[]` |
| `clientId` | `string` | `undefined` | 설정 시 `approved_clients`에 포함 여부를 체크 |
| `loginRedirectUrl` | `string \| (request: NextRequest) => string` | `undefined` | 미인증 시 Google 로그인 후 돌아올 URL. deep link 보존이 필요하면 `(request) => request.url` 사용. 미설정 시 `"/"` 로 redirect |
| `unapprovedRedirectUrl` | `string \| (request: NextRequest) => string` | `undefined` | 로그인은 됐지만 `clientId` 미승인일 때 redirect할 URL. 미설정 시 auth-server `/error?code=FORBIDDEN`로 redirect (무한 loop 방지) |
| `onAuthSuccess` | `(claims, request, response) => Promise<NextResponse> \| NextResponse` | `undefined` | 보호 경로에서 인증 성공 시 호출되는 콜백. DB 동기화, 헤더 주입 등 앱별 로직에 사용 |

#### 동작 방식

**Bypass 경로** (기본 PWA/정적 리소스 + `bypassPaths`):

1. `/sw.js`, `/manifest.webmanifest`, `/manifest.json`, `/favicon.ico` 등은 인증/갱신 없이 항상 통과
2. 가능하면 `matcher`에서도 제외해 proxy 실행 자체를 피하는 것을 권장

**보호 경로** (`publicPaths`에 해당하지 않는 경로):

1. `lemon_access_token` 쿠키가 있고 만료까지 60초 이상 남았으면 → JWKS 검증 → `onAuthSuccess` 호출 → 통과
2. 로그인은 됐지만 `clientId` 미승인이면 `unapprovedRedirectUrl`로 redirect
3. 만료 임박이거나 검증 실패 시 `lemon_refresh_token` + `device_id`로 자동 갱신 시도
4. 갱신 성공 → 새 토큰 쿠키 설정 → `onAuthSuccess` 호출 → 통과
5. 갱신 실패 → `loginRedirectUrl`을 `redirect_url`로 담아 로그인 페이지로 redirect

`loginRedirectUrl`은 고정 URL 문자열과 요청별 resolver 함수를 모두 지원합니다.

```ts
createAuthProxy({
  // 로그인 후 항상 같은 화면으로 복귀
  loginRedirectUrl: "https://myapp.lemondouble.com/dashboard",
});

createAuthProxy({
  // 로그인 후 사용자가 원래 요청한 path/query로 복귀
  loginRedirectUrl: (request) => request.url,
});
```

**공개 경로** (`publicPaths`에 해당하는 경로):

1. 토큰이 만료 임박이면 백그라운드로 갱신 (실패해도 통과)
2. 인증 여부와 무관하게 항상 통과

**API 경로** (`apiPaths` 매칭, 기본 `/api/*`):

보호 경로 중 `apiPaths`에 매칭되는 요청은 인증 실패 시 redirect 대신 JSON 응답을 반환합니다. fetch 호출이 OAuth HTML로 리다이렉트되어 계약이 깨지는 문제를 방지합니다.

| 상황 | 응답 |
|------|------|
| 미인증 (access/refresh 모두 실패) | `401 { "code": "UNAUTHORIZED" }` |
| 미승인 (`clientId` 미포함) | `403 { "code": "FORBIDDEN" }` |

`PROXY_AUTH_ERROR` 상수와 `ProxyAuthErrorCode` 타입을 export합니다.

```ts
import { PROXY_AUTH_ERROR } from "@lemondouble/lemon-auth/proxy";
import type { ProxyAuthErrorCode } from "@lemondouble/lemon-auth/proxy";

const res = await fetch("/api/users");
if (!res.ok) {
  const data = (await res.json()) as { code: ProxyAuthErrorCode };
  if (data.code === PROXY_AUTH_ERROR.UNAUTHORIZED) {
    // 재로그인 유도
  }
  if (data.code === PROXY_AUTH_ERROR.FORBIDDEN) {
    // "권한 없음" 표시
  }
}
```

`/api/*` 외의 경로(예: tRPC, GraphQL)도 JSON 응답을 받게 하려면 `apiPaths`에 추가합니다.

```ts
import { DEFAULT_API_PATHS } from "@lemondouble/lemon-auth/proxy";

createAuthProxy({
  apiPaths: [...DEFAULT_API_PATHS, "/trpc/*"],
});
```

`apiPaths: []`로 두면 모든 보호 경로가 redirect로 동작합니다 (이전 버전 동작).

---

## Client — `@lemondouble/lemon-auth/client`

Client Components에서 사용합니다.

### `<AuthProvider>` + `useAuth()`

Server Component에서 유저 정보를 받아 Client Component 트리에 전달합니다.

```tsx
// app/layout.tsx (Server Component)
import { getUser } from "@lemondouble/lemon-auth/server";
import { AuthProvider } from "@lemondouble/lemon-auth/client";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();

  return (
    <html lang="ko">
      <body>
        <AuthProvider user={user}>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
```

```tsx
// components/nav.tsx (Client Component)
"use client";
import { useAuth } from "@lemondouble/lemon-auth/client";

export function Nav() {
  const { user, isAuthenticated } = useAuth();
  // user: LemonUser | null
  // isAuthenticated: boolean

  if (!isAuthenticated) return <a href="/login">로그인</a>;
  return <span>{user!.nickname}</span>;
}
```

### `<AutoTokenRefresh>`

PWA 환경에서 service worker 캐시로 인해 proxy가 실행되지 않는 경우를 대비합니다.
`AuthProvider`의 `user`가 null일 때만 토큰 갱신을 시도하고, 성공하면 `router.refresh()`로 서버 컴포넌트를 다시 렌더합니다.

```tsx
// app/layout.tsx
import { getUser } from "@lemondouble/lemon-auth/server";
import { AuthProvider, AutoTokenRefresh } from "@lemondouble/lemon-auth/client";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  return (
    <html lang="ko">
      <body>
        <AuthProvider user={user}>
          <AutoTokenRefresh fallback={<p>세션 복원 중...</p>}>
            <p>로그인이 필요합니다</p>
          </AutoTokenRefresh>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
```

| prop | 타입 | 필수 | 설명 |
|------|------|------|------|
| `fallback` | `React.ReactNode` | **필수** | 토큰 갱신 시도 중 렌더할 UI (스피너 등) |
| `children` | `React.ReactNode` | 선택 | 갱신 실패 시 렌더할 UI (로그인 버튼 등) |

**동작 방식:**

| 상황 | user | AutoTokenRefresh |
|------|------|-----------------|
| 정상 요청 (proxy 실행됨) | 있음 | 아무것도 안 함 (skip) |
| PWA 캐시 히트 + 갱신 시도 중 | 없음 | `fallback` 렌더 |
| PWA 캐시 히트 + 유효한 `lemon_refresh_token` | 없음 | 갱신 → `router.refresh()` |
| PWA 캐시 히트 + 만료된 `lemon_refresh_token` | 없음 | 갱신 실패 → `children` 렌더 |

### `loginUrl(redirectUrl)`

Google 로그인 URL을 생성합니다. `<a>` 태그나 `window.location.href`에 사용합니다.

```ts
import { loginUrl } from "@lemondouble/lemon-auth/client";

loginUrl("https://myapp.lemondouble.com/dashboard")
// → "https://auth.lemondouble.com/api/oauth2/google/login?redirect_url=https%3A%2F%2Fmyapp.lemondouble.com%2Fdashboard"
```

| 파라미터 | 타입 | 설명 |
|---------|------|------|
| `redirectUrl` | `string` | 로그인 완료 후 돌아올 URL (`https://` + `*.lemondouble.com`만 허용) |

### `logout()`

로그아웃을 수행합니다. `lemon_refresh_token`을 폐기하고 쿠키를 삭제합니다.

```tsx
"use client";
import { logout } from "@lemondouble/lemon-auth/client";

function LogoutButton() {
  const handleLogout = async () => {
    await logout();
    window.location.href = "/";
  };

  return <button onClick={handleLogout}>로그아웃</button>;
}
```

### `profileUrl(redirectUrl?)`

프로필 편집 페이지 URL을 생성합니다. 닉네임/프로필 이미지 변경 페이지로 이동시킬 때 사용합니다.

```ts
import { profileUrl } from "@lemondouble/lemon-auth/client";

profileUrl()
// → "https://auth.lemondouble.com/profile"

profileUrl("https://myapp.lemondouble.com/settings")
// → "https://auth.lemondouble.com/profile?redirect_url=https%3A%2F%2Fmyapp.lemondouble.com%2Fsettings"
```

| 파라미터 | 타입 | 기본값 | 설명 |
|---------|------|--------|------|
| `redirectUrl` | `string` | `undefined` | 편집 완료 후 돌아올 URL. 설정하면 "← 돌아가기" 버튼이 표시됨 |

### `refreshToken()`

클라이언트에서 토큰 갱신을 수행합니다. 보통 proxy에서 자동으로 처리하므로 직접 호출할 일은 적습니다.

```ts
import { refreshToken } from "@lemondouble/lemon-auth/client";

const ok = await refreshToken();
// → boolean (갱신 성공 여부)
```

---

## 타입

세 엔트리포인트 모두에서 타입을 import할 수 있습니다.

```ts
import type { LemonUser, AccessTokenClaims } from "@lemondouble/lemon-auth/server";
import type { LemonUser } from "@lemondouble/lemon-auth/client";
import type { LemonUser, AccessTokenClaims } from "@lemondouble/lemon-auth/proxy";
```

```ts
interface LemonUser {
  uid: string;
  nickname: string;
  profileImageUrl: string;
  role: "user" | "admin";
  approvedClients: string[];
}

interface AccessTokenClaims extends JWTPayload {
  sub: string;
  nickname: string;
  profile_image_url: string;
  role: "user" | "admin";
  approved_clients: string[];
}

interface UserProfile {
  uid: string;
  nickname: string;
  profile_image_url: string;
  role: "user" | "admin";
}
```

---

## 전체 연동 예시

새 Next.js 16 프로젝트에 인증을 추가하는 최소 예시입니다.

### 1. proxy.ts — 토큰 자동 갱신

```ts
import { createAuthProxy } from "@lemondouble/lemon-auth/proxy";

export default createAuthProxy({
  publicPaths: ["/", "/login"],
  clientId: process.env.CLIENT_ID,
  loginRedirectUrl: process.env.NEXT_PUBLIC_BASE_URL,
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

`onAuthSuccess`를 사용하면 인증 성공 후 DB 동기화, 헤더 주입 등 앱별 로직을 끼워넣을 수 있습니다:

```ts
import { createAuthProxy } from "@lemondouble/lemon-auth/proxy";
import { upsertUser } from "@/lib/db";

export default createAuthProxy({
  publicPaths: ["/", "/login"],
  clientId: process.env.CLIENT_ID,
  loginRedirectUrl: process.env.NEXT_PUBLIC_BASE_URL,
  onAuthSuccess: async (claims, request, response) => {
    await upsertUser(claims);
    response.headers.set("x-user-uid", claims.sub);
    response.headers.set("x-user-nickname", encodeURIComponent(claims.nickname));
    return response;
  },
});
```

### 2. app/layout.tsx — AuthProvider + AutoTokenRefresh

```tsx
import { getUser } from "@lemondouble/lemon-auth/server";
import { AuthProvider, AutoTokenRefresh } from "@lemondouble/lemon-auth/client";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  return (
    <html lang="ko">
      <body>
        <AuthProvider user={user}>
          <AutoTokenRefresh fallback={<p>세션 복원 중...</p>} />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
```

### 3. app/page.tsx — 공개 페이지 (로그인 버튼)

```tsx
import { getUser } from "@lemondouble/lemon-auth/server";
import { redirect } from "next/navigation";
import { LoginButton } from "@/components/login-button";

export default async function Home() {
  const user = await getUser();
  if (user) redirect("/dashboard");
  return <LoginButton />;
}
```

```tsx
// components/login-button.tsx
"use client";
import { loginUrl } from "@lemondouble/lemon-auth/client";

export function LoginButton() {
  return <a href={loginUrl("https://myapp.lemondouble.com/dashboard")}>Google로 로그인</a>;
}
```

### 4. app/dashboard/page.tsx — 보호 페이지

```tsx
import { requireAuth } from "@lemondouble/lemon-auth/server";

export default async function Dashboard() {
  const user = await requireAuth();
  return <h1>{user.nickname}님의 대시보드</h1>;
}
```

### 5. 로그아웃

```tsx
"use client";
import { logout } from "@lemondouble/lemon-auth/client";

export function LogoutButton() {
  return (
    <button onClick={async () => { await logout(); window.location.href = "/"; }}>
      로그아웃
    </button>
  );
}
```
