import type { DeviceBackupArtifacts } from '@maanyio/mpc-coordinator-rn';
import type { ShareStorage } from '@maanyio/mpc-coordinator-rn';
import { bytesFromUtf8, hexFromBytes } from './bytes';

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
    shares: backup.shares.map((share, index) => ({ index, value: hexFromBytes(share) })),
  };
}

function makeBackupKey(keyId: string): string {
  return `${keyId}:backup:device`;
}
