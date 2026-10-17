import type { Heatmap, HeatmapRequest, Place, Plan, PlanInputs, Rules, TimeZoneInfo } from "./types";

/** Errors leave the API as {"error": {"code", "message", "fields"?}}. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly fields?: Record<string, unknown>,
  ) {
    super(message);
  }
}

const BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") ?? "";

async function request<T>(path: string, init: RequestInit & { signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/${path}`, {
      ...init,
      headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) },
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError("network", "Can't reach the server. Check your connection and try again.", 0);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const error = body?.error;
    throw new ApiError(
      error?.code ?? "http_error",
      error?.message ?? `The server answered ${res.status}.`,
      res.status,
      error?.fields,
    );
  }
  return body as T;
}

export const api = {
  geocode(q: string, near: { lat: number; lon: number } | null, signal?: AbortSignal) {
    const params = new URLSearchParams({ q });
    if (near) {
      params.set("lat", near.lat.toFixed(3));
      params.set("lon", near.lon.toFixed(3));
    }
    return request<{ results: Place[] }>(`geocode?${params}`, { signal }).then((r) => r.results);
  },
  reverse(lat: number, lon: number, signal?: AbortSignal) {
    return request<{ place: Place | null }>(`reverse?lat=${lat}&lon=${lon}`, { signal }).then((r) => r.place);
  },
  timezone(lat: number, lon: number, signal?: AbortSignal) {
    return request<TimeZoneInfo>(`timezone?lat=${lat}&lon=${lon}`, { signal });
  },
  rules() {
    return request<Rules>("rules");
  },
  plan(inputs: PlanInputs, signal?: AbortSignal) {
    return request<Plan>("plan", { method: "POST", body: JSON.stringify(inputs), signal });
  },
  heatmap(body: HeatmapRequest, signal?: AbortSignal) {
    return request<Heatmap>("heatmap", { method: "POST", body: JSON.stringify(body), signal });
  },
};
