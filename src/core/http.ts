// One JSON-over-HTTP helper for both APIs.
//
// GitHub and Todoist differ only in base URL, auth header, and how they page.
// Everything else -- timeouts, raising on error -- is shared, which is the whole
// reason there is no SDK on either side.

const TIMEOUT_MS = 30_000;

export type Params = Record<string, string | number | boolean | undefined>;

// Loose on purpose: payloads are read field by field at the edges, and the
// tests hand in plain objects shaped like whatever a call returns.
// biome-ignore lint/suspicious/noExplicitAny: JSON straight off the wire
export type Json = any;

export interface Api {
  get(path: string, params?: Params): Promise<Json>;
  post(path: string, body?: Record<string, unknown>): Promise<Json>;
  delete(path: string): Promise<Json>;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly url: string,
    readonly body: string,
  ) {
    super(`${method} ${url} -> ${status}: ${body.slice(0, 300)}`);
  }
}

export class Client implements Api {
  readonly #base: string;
  readonly #headers: Record<string, string>;

  constructor(base: string, token: string, headers: Record<string, string> = {}) {
    this.#base = base;
    this.#headers = { Authorization: `Bearer ${token}`, ...headers };
  }

  get(path: string, params: Params = {}): Promise<Json> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) query.set(key, String(value));
    }
    const suffix = query.size ? `?${query}` : "";
    return this.#request("GET", `${path}${suffix}`);
  }

  post(path: string, body: Record<string, unknown> = {}): Promise<Json> {
    return this.#request("POST", path, body);
  }

  delete(path: string): Promise<Json> {
    return this.#request("DELETE", path);
  }

  async #request(method: string, path: string, body?: unknown): Promise<Json> {
    const url = `${this.#base}${path}`;
    const response = await fetch(url, {
      method,
      headers: {
        ...this.#headers,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      // null has to survive: it is how a field such as deadline_date is cleared.
      body: body === undefined ? null : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await response.text();
    if (!response.ok) throw new HttpError(response.status, method, url, text);
    return text ? JSON.parse(text) : null;
  }
}
