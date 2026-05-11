/** Per-tab UUID. Stays stable for the lifetime of the tab so the WS
 * broadcaster can avoid echoing changes back to the originating tab.
 */
const KEY = 'lyst-client-id';

export function getClientId(): string {
  let cid = sessionStorage.getItem(KEY);
  if (!cid) {
    cid = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `cid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(KEY, cid);
  }
  return cid;
}
