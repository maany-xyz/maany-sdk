import type { DeviceBackupArtifacts, BackupCiphertext } from '@maanyio/mpc-coordinator-rn';
import type { ShareStorage } from '@maanyio/mpc-coordinator-rn';
import { bytesFromUtf8, hexFromBytes, bytesFromHex, utf8FromBytes } from './bytes';

export async function persistDeviceBackupLocally(params: {
  storage: ShareStorage;
  keyId: string;
  backup: DeviceBackupArtifacts;
}): Promise<void> {
  const { storage, keyId, backup } = params;
  try {
    const payload = JSON.stringify(serializeBackup(backup));
    await storage.save({ keyId: makeBackupKey(keyId), blob: bytesFromUtf8(payload) });
    console.log('[maany-sdk] backup: persisted local recovery fragment for', keyId);
  } catch (error) {
    console.warn('[maany-sdk] backup: failed to persist local fragment', error);
  }
}

function serializeBackup(backup: DeviceBackupArtifacts) {
  return {
    ciphertext: {
      ...backup.ciphertext,
      keyId: hexFromBytes(backup.ciphertext.keyId),
      label: hexFromBytes(backup.ciphertext.label),
      blob: hexFromBytes(backup.ciphertext.blob),
    },
    shares: backup.shares.length ? [{ index: 0, value: hexFromBytes(backup.shares[0]) }] : [],
  };
}

function makeBackupKey(keyId: string): string {
  return `${keyId}:backup:device`;
}

export async function loadPersistedDeviceBackup(params: {
  storage: ShareStorage;
  keyId: string;
}): Promise<DeviceBackupArtifacts | null> {
  const record = await params.storage.load(makeBackupKey(params.keyId));
  if (!record) {
    return null;
  }
  try {
    const decoded = JSON.parse(utf8FromBytes(record.blob));
    return deserializeBackup(decoded);
  } catch (error) {
    console.warn('[maany-sdk] backup: failed to parse local backup artifact', error);
    return null;
  }
}

function deserializeBackup(value: any): DeviceBackupArtifacts {
  const ciphertext = deserializeCiphertext(value?.ciphertext);
  const shares = Array.isArray(value?.shares)
    ? value.shares
        .map((entry: any) => (typeof entry?.value === 'string' ? bytesFromHex(entry.value) : null))
        .filter((entry: Uint8Array | null): entry is Uint8Array => entry !== null)
    : [];
  return {
    ciphertext,
    shares,
  };
}

function deserializeCiphertext(value: any): BackupCiphertext {
  if (!value) {
    throw new Error('Missing ciphertext payload');
  }
  return {
    kind: value.kind,
    curve: value.curve,
    scheme: value.scheme,
    keyId: bytesFromHex(String(value.keyId ?? '')),
    threshold: value.threshold,
    shareCount: value.shareCount,
    label: bytesFromHex(String(value.label ?? '')),
    blob: bytesFromHex(String(value.blob ?? '')),
  };
}
