/**
 * 진단 로그.
 *
 * 이 라이브러리는 오랫동안 실패를 전부 `null` 하나로만 알렸다. 2026-07-19 에
 * auth 서버 앞의 Cloudflare Bot Fight Mode 가 프록시의 갱신 요청을 403
 * (`cf-mitigated: challenge`) 으로 막았을 때, 남은 흔적이 하나도 없어서
 * 원인을 찾는 데 반나절이 걸렸다. 앱 쪽에 임시 진단 코드를 심고 프로덕션에
 * 두 번 배포한 뒤에야 응답 코드를 볼 수 있었다.
 *
 * 그래서 실패에는 최소한의 사실을 남긴다.
 *
 * **토큰 값은 절대 남기지 않는다.** JWT 는 base64url 이라 "접두 8자" 같은
 * 안전해 보이는 일부만으로도 헤더와 payload 앞부분이 그대로 복원된다.
 * `sub`, `nickname`, `approved_clients` 가 거기 들어 있다. 남길 수 있는 것은
 * 쿠키 **이름**, HTTP 상태 코드, 에러 코드처럼 값이 아닌 사실뿐이다.
 */

const PREFIX = "[lemon-auth]";

export function warnAuth(
  event: string,
  detail?: Record<string, unknown>
): void {
  if (detail === undefined) {
    console.warn(`${PREFIX} ${event}`);
    return;
  }
  console.warn(`${PREFIX} ${event}`, JSON.stringify(detail));
}

/**
 * 에러에서 값 노출 없이 식별자만 뽑는다.
 *
 * jose 는 `ERR_JWKS_NO_MATCHING_KEY`(키 로테이션), `ERR_JWT_EXPIRED`(정상 만료),
 * `ERR_JWS_SIGNATURE_VERIFICATION_FAILED`(위조 또는 설정 오류) 처럼 원인이
 * 전혀 다른 실패를 구분 가능한 `code` 로 준다. 이걸 뭉개면 JWKS 장애와
 * 위조 토큰이 같은 증상으로 보인다.
 *
 * undici 의 네트워크 실패는 `cause.code` 에 `ENOTFOUND` 같은 값이 들어간다.
 */
export function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const { code, cause } = error as { code?: unknown; cause?: unknown };
    if (typeof code === "string") return code;
    if (typeof cause === "object" && cause !== null) {
      const causeCode = (cause as { code?: unknown }).code;
      if (typeof causeCode === "string") return causeCode;
    }
  }
  if (error instanceof Error) return error.name;
  return "unknown";
}
