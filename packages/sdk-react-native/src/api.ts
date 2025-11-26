import { readEnv } from './env';

export interface WalletExistenceCheckOptions {
  baseUrl: string;
  walletId: string;
  token?: string;
}

export async function walletExistsRemotely(options: WalletExistenceCheckOptions): Promise<boolean> {
  const url = buildWalletUrl(options.baseUrl, options.walletId);
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  const response = await fetch(url, {
    method: 'GET',
    headers,
  });
  if (response.status === 200) {
    return true;
  }
  if (response.status === 404) {
    return false;
  }
  const body = await safeReadBody(response);
  throw new Error(`wallet lookup failed with status ${response.status}${body ? `: ${body}` : ''}`);
}

function buildWalletUrl(baseUrl: string, walletId: string): string {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return `${normalizedBase}/wallets/${walletId}`;
}

async function safeReadBody(response: FetchResponse): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
    console.warn('[maany-sdk] failed to read wallet lookup body', error);
    return '';
  }
}

export function resolveApiBaseUrl(explicit?: string, serverUrl?: string): string | undefined {
  if (explicit) {
    return explicit;
  }
  const envValue = readEnv('EXPO_PUBLIC_MPC_API_URL', 'MAANY_MPC_API_URL');
  if (envValue) {
    return envValue;
  }
  if (serverUrl) {
    return deriveApiUrlFromServer(serverUrl);
  }
  return undefined;
}

function deriveApiUrlFromServer(serverUrl: string): string | undefined {
  try {
    const parsed = new URL(serverUrl);
    parsed.protocol = parsed.protocol === 'wss:' ? 'https:' : 'http:';
    parsed.port = '8082';
    return parsed.toString().replace(/\/$/, '');
  } catch (error) {
    console.warn('[maany-sdk] failed to derive API URL from server URL', error);
    return undefined;
  }
}
