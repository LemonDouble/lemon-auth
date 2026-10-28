/**
 * 로그인 뒤에 돌아갈 주소를 앱 안의 경로로만 받는다 (오픈 리다이렉트 방지).
 * 브라우저 URL 파서는 탭과 줄바꿈을 지우고 `\` 를 `/` 로 읽으므로, 그런 문자가 있으면 거부한다.
 */
export function safeNextPath(rawPath: string | null | undefined, origin: string): string {
  if (!rawPath || /[\u0000-\u001f\u007f\\]/.test(rawPath)) return "/";
  if (!rawPath.startsWith("/") || rawPath.startsWith("//")) return "/";

  const url = new URL(rawPath, origin);
  if (url.origin !== origin) return "/";
  return url.pathname + url.search + url.hash;
}
