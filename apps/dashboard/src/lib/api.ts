let organizationId: string | undefined;
let scope = new AbortController();
export function selectOrganization(id?: string) {
  if (organizationId !== id) { scope.abort(); scope = new AbortController(); organizationId = id; }
}
export function controlDownloadUrl(path: string) {
  return `/control${path}${organizationId ? `${path.includes("?") ? "&" : "?"}organization=${encodeURIComponent(organizationId)}` : ""}`;
}
export function currentOrganization() { return organizationId; }

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/control${path}`, {
    credentials: "include",
    signal: scope.signal,
    ...options,
    headers: {
      ...(options?.body ? { "Content-Type": "application/json" } : {}),
      ...(organizationId ? { "x-pyro-organization": organizationId } : {}),
      ...options?.headers,
    },
  });
  if (response.status === 204) return undefined as T;
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = {};
  }
  if (!response.ok) {
    const message = typeof body === "object" && body && "error" in body ? String(body.error) : `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  delete: <T>(path: string, body?: unknown) => request<T>(path, { method: "DELETE", body: body === undefined ? undefined : JSON.stringify(body) }),
};

export function controlWebSocketUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/control/ws${organizationId ? `?organization=${encodeURIComponent(organizationId)}` : ""}`;
}
