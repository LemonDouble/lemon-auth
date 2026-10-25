import { NextResponse } from "next/server";
import { REFRESH_URL } from "../constants.js";
import emblemSvg from "./restore-emblem.svg";

export function restorePageResponse(): NextResponse {
  return new NextResponse(RESTORE_PAGE, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/**
 * 색과 폰트는 lemon-design-system 토큰 값이고, 엠블럼은 디자인 시스템의 lemon-character-mono.svg 다.
 * 화면이 바로 그려지도록 외부 CSS 를 기다리지 않는다.
 */
const RESTORE_PAGE = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#12100E">
<title>세션 복원 중</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/pretendard/1.3.9/static/pretendard.min.css" media="print" onload="this.media='all'">
<style>
:root {
  --color-primary: #F0B90B;
  --color-primary-hover: #D4A30A;
  --color-bg: #12100E;
  --color-border: #2E2723;
  --color-fg: #F5F0EB;
  --color-fg-muted: #8D7E72;
  --color-warning: #F59E0B;
  --color-focus-ring: var(--color-fg-muted);
  --font-sans: 'Pretendard', -apple-system, BlinkMacSystemFont, sans-serif;
  --radius-lg: 8px;
}
* { margin: 0; box-sizing: border-box; }
body {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 20px;
  background: var(--color-bg);
  color: var(--color-fg-muted);
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.6;
  text-align: center;
}
:focus-visible { outline: 2px solid var(--color-focus-ring); outline-offset: 2px; }
[hidden] { display: none !important; }
main { display: flex; flex-direction: column; align-items: center; gap: 28px; }
.emblem { width: 120px; color: var(--color-fg); }
.emblem svg { display: block; width: 100%; height: auto; }
.state { display: flex; flex-direction: column; align-items: center; gap: 16px; }
.title { color: var(--color-fg); font-size: 15px; font-weight: 700; line-height: 1.4; }
.spinner {
  width: 40px;
  height: 40px;
  border: 5px solid var(--color-border);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 2.4s; } }
.alert-icon { color: var(--color-warning); }
button {
  min-height: 40px;
  padding: 10px 20px;
  border: none;
  border-radius: var(--radius-lg);
  background: var(--color-primary);
  color: var(--color-bg);
  font: 600 14px/1 var(--font-sans);
  cursor: pointer;
}
button:hover { background: var(--color-primary-hover); }
</style>
</head>
<body>
<main>
  <div class="emblem" aria-hidden="true">${emblemSvg}</div>
  <div id="restoring" class="state" role="status">
    <span class="spinner" aria-hidden="true"></span>
    <div><p class="title">세션 복원 중</p><p>잠시만 기다려 주세요</p></div>
  </div>
  <div id="unavailable" class="state" role="alert" hidden>
    <svg class="alert-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>
    <div><p class="title">인증 서버에 연결하지 못했습니다</p><p>잠시 후 다시 시도해 주세요</p></div>
    <button type="button" onclick="location.reload()">다시 시도</button>
  </div>
</main>
<script>
function showUnavailable() {
  document.getElementById("restoring").hidden = true;
  document.getElementById("unavailable").hidden = false;
}

// 401·403 은 세션이 죽은 것이고 auth 서버가 쿠키를 지웠으므로, 새로고침하면 프록시가 로그인으로 보낸다.
// 그 밖의 실패는 서버·네트워크 사정이라 토큰이 살아 있을 수 있으므로 재시도만 권한다.
fetch("${REFRESH_URL}", { method: "POST", credentials: "include" }).then(
  (response) => {
    if (response.ok || response.status === 401 || response.status === 403) {
      location.reload();
      return;
    }
    showUnavailable();
  },
  showUnavailable
);
</script>
</body>
</html>
`;
