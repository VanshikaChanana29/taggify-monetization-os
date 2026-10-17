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
  return `Request failed (${status})`;
}

/** Call the backend through the same-origin /api proxy. */
export async function api<T>(path: string, { json, form, headers, ...init }: ApiOptions = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: json === undefined ? headers : { "Content-Type": "application/json", ...headers },
    body: form ?? (json === undefined ? undefined : JSON.stringify(json)),
  });

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
