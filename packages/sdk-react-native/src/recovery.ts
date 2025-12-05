import type { BackupCiphertext } from '@maanyio/mpc-coordinator-rn';
import { bytesFromBase64, bytesFromHex } from './bytes';

interface CoordinatorRecoveryOptions {
  baseUrl: string;
  walletId: string;
  token?: string;
}

interface CoordinatorRecoveryPayload {
  ciphertext: RecoveryCiphertextPayload;
  fragment: string;
  fragmentEncoding?: string;
}

interface RecoveryCiphertextPayload {
  kind: BackupCiphertext['kind'];
  curve: BackupCiphertext['curve'];
  scheme: BackupCiphertext['scheme'];
  keyId: string;
  keyIdEncoding?: 'hex' | 'base64';
  threshold: number;
  shareCount: number;
  label: string;
  labelEncoding?: string;
  blob: string;
  blobEncoding?: string;
}

export async function fetchCoordinatorRecoveryArtifact(options: CoordinatorRecoveryOptions): Promise<{
  ciphertext: BackupCiphertext;
  fragment: Uint8Array;
}> {
  const url = `${trimTrailingSlash(options.baseUrl)}/wallets/${options.walletId}/recovery`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  const response = await fetch(url, { method: 'GET', headers });
  const body = await response.text();
  if (response.status !== 200) {
    throw new Error(`Coordinator recovery fetch failed (${response.status})${body ? `: ${body}` : ''}`);
  }
  const parsed = JSON.parse(body) as CoordinatorRecoveryPayload;
  return {
    ciphertext: decodeRecoveryCiphertext(parsed.ciphertext),
    fragment: bytesFromBase64(parsed.fragment),
  };
}

export async function fetchThirdPartyRecoveryFragment(options: {
  baseUrl: string;
  walletId: string;
  token?: string;
}): Promise<Uint8Array> {
  const url = `${trimTrailingSlash(options.baseUrl)}/fragments/${options.walletId}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  const response = await fetch(url, { method: 'GET', headers });
  const body = await response.text();
  if (response.status !== 200) {
    throw new Error(`Partner recovery fetch failed (${response.status})${body ? `: ${body}` : ''}`);
  }
  const parsed = JSON.parse(body);
  const fragment = typeof parsed?.fragment === 'string' ? parsed.fragment : '';
  if (!fragment) {
    throw new Error('Partner recovery response missing fragment');
  }
  return bytesFromBase64(fragment);
}

function decodeRecoveryCiphertext(value: RecoveryCiphertextPayload): BackupCiphertext {
  return {
    kind: value.kind,
    curve: value.curve,
    scheme: value.scheme,
    keyId: decodeByEncoding(value.keyId, value.keyIdEncoding),
    threshold: value.threshold,
    shareCount: value.shareCount,
    label: decodeByEncoding(value.label, value.labelEncoding),
    blob: decodeByEncoding(value.blob, value.blobEncoding),
  };
}

function decodeByEncoding(value: string, encoding?: string): Uint8Array {
  if (!value) {
    return new Uint8Array(0);
  }
  if (!encoding || encoding === 'hex') {
    return bytesFromHex(value);
  }
  return bytesFromBase64(value);
}

function trimTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}
