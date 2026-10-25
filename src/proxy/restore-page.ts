import { NextResponse } from "next/server";
import { REFRESH_URL } from "../constants.js";
import winkImage from "./restore-images/wink.webp";
import booksImage from "./restore-images/books.webp";
import monitorImage from "./restore-images/monitor.webp";
import failureImage from "./restore-images/failure.webp";

/** 일러스트 안 태블릿 화면의 위치(%). 이 영역만 투명하게 뚫려 있어서 뒤에 깐 스피너가 비친다. */
interface ScreenArea {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface RestoreIllustration {
  src: string;
  screen: ScreenArea;
  /** 가로로 긴 화면에서 키우는 배율. 앉은 포즈는 책이 잘리지 않게 덜 키운다. */
  wideScale: number;
}

const ILLUSTRATIONS: RestoreIllustration[] = [
  {
    src: winkImage,
    screen: { left: 31.37, top: 41.46, width: 37.6, height: 14.31 },
    wideScale: 1.5,
  },
  {
    src: booksImage,
    screen: { left: 33.22, top: 37.54, width: 33.68, height: 13.46 },
    wideScale: 1.2,
  },
  {
    src: monitorImage,
    screen: { left: 18.69, top: 38.31, width: 60.09, height: 22.54 },
    wideScale: 1.5,
  },
];

const FAILURE_ILLUSTRATION: RestoreIllustration = {
  src: failureImage,
  screen: { left: 32.74, top: 41.55, width: 34.52, height: 14 },
  wideScale: 1.5,
};

export function restorePageResponse(): NextResponse {
  const illustration =
    ILLUSTRATIONS[Math.floor(Math.random() * ILLUSTRATIONS.length)];
  return new NextResponse(renderRestorePage(illustration), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function stageStyle({ screen, wideScale }: RestoreIllustration): string {
  return [
    `--screen-left: ${screen.left}%`,
    `--screen-top: ${screen.top}%`,
    `--screen-width: ${screen.width}%`,
    `--screen-height: ${screen.height}%`,
    `--wide-scale: ${wideScale}`,
  ].join("; ");
}

/**
 * 색과 폰트는 lemon-design-system 토큰 값이다. 화면이 바로 그려지도록 외부 CSS 를 기다리지 않는다.
 * 실패 일러스트는 네트워크가 나쁠 때 쓰이므로 따로 받지 않고 HTML 맨 끝에 같이 싣는다.
 */
function renderRestorePage(illustration: RestoreIllustration): string {
  return `<!doctype html>
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
  --color-surface: #1C1816;
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
  overflow: hidden;
  background: var(--color-bg);
  color: var(--color-fg);
  font-family: var(--font-sans);
}
:focus-visible { outline: 2px solid var(--color-focus-ring); outline-offset: 2px; }
[hidden] { display: none !important; }
.stage {
  position: fixed;
  top: 0;
  left: 50%;
  height: 100dvh;
  aspect-ratio: 2 / 3;
  transform: translateX(-50%);
}
@media (min-aspect-ratio: 1/1) {
  .stage {
    height: calc(100dvh * var(--wide-scale));
    top: calc((1 - var(--wide-scale)) * 12dvh);
  }
}
.illustration { position: absolute; inset: 0; width: 100%; height: 100%; }
.screen {
  position: absolute;
  left: var(--screen-left);
  top: var(--screen-top);
  width: var(--screen-width);
  height: var(--screen-height);
  display: grid;
  place-items: center;
  background: radial-gradient(circle, var(--color-surface), var(--color-bg) 75%);
  font-size: 13px;
  font-weight: 500;
  line-height: 1.5;
  text-align: center;
}
.state { display: flex; flex-direction: column; align-items: center; gap: 10px; }
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
.retry {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  justify-content: center;
  padding: 72px 20px calc(36px + env(safe-area-inset-bottom));
  background: linear-gradient(to top, var(--color-bg) 40%, transparent);
}
.retry button {
  min-height: 40px;
  padding: 10px 20px;
  border: none;
  border-radius: var(--radius-lg);
  background: var(--color-primary);
  color: var(--color-bg);
  font: 600 14px/1 var(--font-sans);
  cursor: pointer;
}
.retry button:hover { background: var(--color-primary-hover); }
</style>
</head>
<body>
<div class="stage" style="${stageStyle(illustration)}">
  <div class="screen">
    <div id="restoring" class="state" role="status">
      <span class="spinner" aria-hidden="true"></span>
      <p>세션 복원 중...</p>
    </div>
    <div id="unavailable" class="state" role="alert" hidden>
      <svg class="alert-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>
      <p>인증 서버에<br>연결하지 못했습니다</p>
    </div>
  </div>
  <img class="illustration" src="${illustration.src}" alt="" decoding="sync">
</div>
<div id="retry" class="retry" hidden>
  <button type="button" onclick="location.reload()">다시 시도</button>
</div>
<script>
function showUnavailable() {
  document.getElementById("restoring").hidden = true;
  document.getElementById("unavailable").hidden = false;
  document.getElementById("retry").hidden = false;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", showFailureIllustration);
  } else {
    showFailureIllustration();
  }
}

// 디코딩이 끝난 뒤 그림과 화면 위치를 한 번에 바꿔야 문구가 어긋난 자리에 잠깐 뜨지 않는다.
function showFailureIllustration() {
  const failure = document.getElementById("failure-illustration").dataset;
  const image = new Image();
  image.src = failure.src;
  image.decode().then(() => {
    document.querySelector(".illustration").src = image.src;
    document.querySelector(".stage").setAttribute("style", failure.stageStyle);
  }, () => {});
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
<div id="failure-illustration" hidden data-src="${FAILURE_ILLUSTRATION.src}" data-stage-style="${stageStyle(FAILURE_ILLUSTRATION)}"></div>
</body>
</html>
`;
}
