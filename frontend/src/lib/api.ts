export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type ApiOptions = Omit<RequestInit, "body"> & { json?: unknown; form?: FormData };

function errorMessage(data: unknown, status: number): string {
  const detail = (data as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.map((d: { msg?: string }) => d.msg ?? "Invalid value").join(", ");
  }
  if (WAKING.has(status)) {
    return "The server is starting up after being idle. Wait a minute, then try again.";
  }
  return `Request failed (${status})`;
}

// Gateway errors while the API wakes from sleep (Render free plan).
const WAKING = new Set([502, 503, 504]);
const RETRY_DELAYS_MS = [3000, 8000, 15000];

/** Only requests that are safe to send twice are retried. */
function canRetry(path: string, method: string): boolean {
  return method === "GET" || method === "HEAD" || path === "/auth/login";
}

/** Call the backend through the same-origin /api proxy. */
export async function api<T>(path: string, { json, form, headers, ...init }: ApiOptions = {}): Promise<T> {
  const send = () =>
    fetch(`/api${path}`, {
      ...init,
      headers: json === undefined ? headers : { "Content-Type": "application/json", ...headers },
      body: form ?? (json === undefined ? undefined : JSON.stringify(json)),
    });
  let response = await send();
  if (canRetry(path, (init.method ?? "GET").toUpperCase())) {
    for (const delay of RETRY_DELAYS_MS) {
      if (!WAKING.has(response.status)) break;
      await new Promise((resolve) => setTimeout(resolve, delay));
      response = await send();
    }
  }

  if (response.status === 401 && window.location.pathname !== "/login") {
    window.location.assign("/login");
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiError(response.status, errorMessage(data, response.status));
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
