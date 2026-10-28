/** 앱 자신의 `/auth/*` 경로를 만든다. `next` 는 앱 안의 경로(`/` 로 시작)만 쓸 수 있다. */

export function loginUrl(next = "/"): string {
  return `/auth/login?next=${encodeURIComponent(next)}`;
}

/** POST 로만 받는다: `<form method="post" action={logoutUrl()}>` */
export function logoutUrl(): string {
  return "/auth/logout";
}

/** auth 서버의 프로필 화면을 열고, 돌아오면 바뀐 프로필을 바로 반영한 뒤 `next` 로 보낸다. */
export function profileUrl(next = "/"): string {
  return `/auth/profile?next=${encodeURIComponent(next)}`;
}
