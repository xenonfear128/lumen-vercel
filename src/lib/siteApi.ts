export interface SiteUser { id: string; username: string; role: 'admin' | 'user'; disabled: boolean }
export interface SiteSession { configured: boolean; initialized: boolean; user: SiteUser | null; csrf: string | null }
let activeSession: SiteSession = { configured: false, initialized: false, user: null, csrf: null };
export function setSiteSession(value: SiteSession) { activeSession = value; }
export function siteSession() { return activeSession; }
export class SiteError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}
export async function siteApi<T>(path: string, body?: unknown, expectedUser?: string): Promise<T> {
  if (expectedUser && activeSession.user?.id !== expectedUser) throw new SiteError('AUTH_REQUIRED', 401);
  const csrf = activeSession.csrf;
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin',
    headers: { ...(body !== undefined && { 'Content-Type': 'application/json', 'X-Lumen-Request': '1' }), ...(csrf && { 'X-Lumen-CSRF': csrf }), ...(expectedUser && { 'X-Lumen-User': expectedUser }) },
    ...(body !== undefined && { body: JSON.stringify(body) }), signal: AbortSignal.timeout(25000),
  });
  const result = await response.json();
  if (expectedUser && activeSession.user?.id !== expectedUser) throw new SiteError('AUTH_REQUIRED', 401);
  if (!response.ok) {
    if (response.status === 401 && expectedUser) window.dispatchEvent(new Event('lumen-session-expired'));
    throw new SiteError(result.error || 'REQUEST_FAILED', response.status);
  }
  return result as T;
}
