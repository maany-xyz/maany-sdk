import { describe, expect, it } from 'vitest';
import { JsonTransport, CosmosError, NetworkError, SerializationError } from '../src';

type MockResponse = {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
};

type FetchMock = (url: string, init?: Record<string, unknown>) => Promise<MockResponse>;

const makeResponse = (status: number, body: string): MockResponse => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body,
});

const createTransport = (fetchFn: FetchMock) =>
  new JsonTransport({ baseUrl: 'http://example.com', fetchFn });

describe('JsonTransport', () => {
  it('returns parsed JSON for successful requests', async () => {
    const fetchFn: FetchMock = async () => makeResponse(200, JSON.stringify({ ready: true }));
    const transport = createTransport(fetchFn);
    const result = await transport.get<{ ready: boolean }>('/ok');
    expect(result).toEqual({ ready: true });
  });

  it('throws CosmosError on non-2xx response', async () => {
    const fetchFn: FetchMock = async () => makeResponse(400, JSON.stringify({ message: 'bad' }));
    const transport = createTransport(fetchFn);
    await expect(transport.get('/fail')).rejects.toBeInstanceOf(CosmosError);
  });

  it('throws SerializationError on invalid JSON', async () => {
    const fetchFn: FetchMock = async () => makeResponse(200, 'not-json');
    const transport = createTransport(fetchFn);
    await expect(transport.get('/bad-json')).rejects.toBeInstanceOf(SerializationError);
  });

  it('throws NetworkError on fetch failure', async () => {
    const fetchFn: FetchMock = async () => {
      throw new TypeError('fetch failed');
    };
    const transport = createTransport(fetchFn);
    await expect(transport.get('/offline')).rejects.toBeInstanceOf(NetworkError);
  });
});
