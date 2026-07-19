import { warnAuth } from "./log.js";

/** fail-open 경고를 요청마다 찍지 않기 위한 플래그. */
let warnedMissingClientId = false;

export function isApprovedClient(
  approvedClients: string[],
  clientId?: string
): boolean {
  if (!clientId) {
    // clientId 를 안 넘기면 승인 검사가 통째로 열린다(fail-open). 이 라이브러리를
    // clientId 없이 쓰는 앱도 있으므로 동작은 유지하지만, 환경변수가 배포에서
    // 빠져서 이렇게 된 경우와 구분이 안 된다. 후자는 인증이 사실상 없는 상태라
    // 조용히 넘어가면 안 된다.
    if (!warnedMissingClientId) {
      warnedMissingClientId = true;
      warnAuth(
        "clientId not provided — approval check is disabled (all users pass). " +
          "설정 누락이 아닌지 확인할 것."
      );
    }
    return true;
  }
  return approvedClients.includes(clientId) || approvedClients.includes("*");
}
