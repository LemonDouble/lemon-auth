import { sealCookieValue, unsealCookieValue } from "../sealed-cookie.js";

/** 로그인을 시작한 브라우저만 콜백을 이어 갈 수 있게, 시작할 때 만든 값을 그 브라우저의 쿠키에 둔다. */
export interface LoginTransaction {
  state: string;
  nonce: string;
  codeVerifier: string;
  /** authorize 에 보낸 redirect_uri. preview 에서는 운영 배포의 콜백이다. */
  redirectUri: string;
  next: string;
}

export const LOGIN_TRANSACTION_MAX_AGE_SECONDS = 10 * 60;

export function sealLoginTransaction(transaction: LoginTransaction): Promise<string> {
  return sealCookieValue({ ...transaction }, LOGIN_TRANSACTION_MAX_AGE_SECONDS);
}

export async function unsealLoginTransaction(value: string | undefined): Promise<LoginTransaction | null> {
  const payload = await unsealCookieValue(value);
  const fields = ["state", "nonce", "codeVerifier", "redirectUri", "next"] as const;
  if (!payload || !fields.every((field) => typeof payload[field] === "string")) return null;
  return {
    state: payload.state as string,
    nonce: payload.nonce as string,
    codeVerifier: payload.codeVerifier as string,
    redirectUri: payload.redirectUri as string,
    next: payload.next as string,
  };
}
