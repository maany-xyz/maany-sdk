import type { DeviceBackupArtifacts } from '@maanyio/mpc-coordinator-rn';
import { bytesToBase64 } from './bytes';

interface ThirdPartyUploadOptions {
  baseUrl: string;
  walletId: string;
  token?: string;
  backup: DeviceBackupArtifacts;
  shareIndex?: number;
}

interface FetchResponse {
  status: number;
  text(): Promise<string>;
}

export async function uploadThirdPartyBackupFragment(options: ThirdPartyUploadOptions): Promise<void> {
  const { baseUrl, walletId, token, backup } = options;
  const shareIndex = options.shareIndex ?? 1;
  const share = backup.shares[shareIndex];
  if (!share) {
    console.warn('[maany-sdk] backup: no share available for third-party upload at index', shareIndex);
    return;
  }
  const url = buildFragmentsUrl(baseUrl, walletId);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const body = JSON.stringify({ fragment: bytesToBase64(share) });
  const response = await fetch(url, { method: 'POST', headers, body });
  if (response.status >= 200 && response.status < 300) {
    console.log('[maany-sdk] backup: uploaded third-party fragment for', walletId);
    return;
  }
  const message = await safeReadBody(response);
  throw new Error(`Third-party backup upload failed with status ${response.status}${message ? `: ${message}` : ''}`);
}

function buildFragmentsUrl(baseUrl: string, walletId: string): string {
  const normalized = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return `${normalized}/fragments/${walletId}`;
}

async function safeReadBody(response: FetchResponse): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
    console.warn('[maany-sdk] backup: failed to read third-party response body', error);
    return '';
  }
}
