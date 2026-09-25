/** 진단 로그. 토큰 값은 일부라도 절대 남기지 않는다 — JWT 는 앞부분만으로 payload 가 복원된다. */

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

/** 에러에서 값 없이 식별 코드만 뽑는다 (jose 의 `code`, 네트워크 실패의 `cause.code`). */
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
