export function isApprovedClient(
  approvedClients: string[],
  clientId?: string
): boolean {
  if (!clientId) return true;
  return approvedClients.includes(clientId) || approvedClients.includes("*");
}
