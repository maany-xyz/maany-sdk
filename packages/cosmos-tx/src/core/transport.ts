import { CosmosError, NetworkError, SerializationError } from './errors';

export interface JsonTransportOptions {
  baseUrl: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  defaultHeaders?: Record<string, string>;
}

export interface RequestOptions {
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

const resolveFetch = (custom?: typeof fetch): typeof fetch => {
  if (custom) {
    return custom;
  }
  if (typeof fetch === 'undefined') {
    throw new Error('Global fetch is not available. Provide a fetch implementation.');
  }
  return fetch;
};

export class JsonTransport {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly defaultHeaders: Record<string, string>;

  constructor(options: JsonTransportOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    const resolvedFetch = resolveFetch(options.fetchFn);
    this.fetchFn = resolvedFetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.defaultHeaders = options.defaultHeaders ?? { 'content-type': 'application/json' };
  }

  async request<T>(options: RequestOptions): Promise<T> {
    const url = new URL(options.path, `${this.baseUrl}/`);
    if (options.query) {
      Object.entries(options.query).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      });
    }

    try {
      const requestUrl = url.toString();
      const response = await this.fetchFn(requestUrl, {
        method: options.method ?? 'GET',
        headers: {
          ...this.defaultHeaders,
          ...options.headers,
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });

      const text = await response.text();
      let parsed: T;
      try {
        parsed = text.length ? (JSON.parse(text) as T) : ({} as T);
      } catch (err) {
        throw new SerializationError('Failed to parse JSON response', { text, cause: err });
      }

      if (!response.ok) {
        throw new CosmosError('Request failed', {
          status: response.status,
          body: parsed,
        });
      }

      return parsed;
    } catch (err: unknown) {
      if (err instanceof CosmosError || err instanceof SerializationError) {
        throw err;
      }
      throw new NetworkError('Network request failed', { cause: err });
    }
  }

  get<T>(path: string, query?: RequestOptions['query']): Promise<T> {
    return this.request<T>({ path, method: 'GET', query });
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>({ path, method: 'POST', body });
  }
}
