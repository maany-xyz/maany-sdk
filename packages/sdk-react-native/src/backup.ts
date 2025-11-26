import type { DeviceBackupArtifacts, BackupCiphertext } from '@maanyio/mpc-coordinator-rn';
import type { Transport } from '@maanyio/mpc-coordinator-rn';
import { bytesFromUtf8, hexFromBytes, utf8FromBytes } from './bytes';

const BACKUP_UPLOAD_MESSAGE_TYPE = 'backup-share';
const BACKUP_ACK_MESSAGE_TYPE = 'backup-share:ack';
const BACKUP_UPLOAD_TIMEOUT_MS = 15_000;

interface BackupUploadPayload {
  type: typeof BACKUP_UPLOAD_MESSAGE_TYPE;
  sessionId: string;
  keyId: string;
  ciphertext: EncodedBackupCiphertext;
  share?: string;
  fragment?: string;
  shareIndex?: number;
}

interface EncodedBackupCiphertext {
  kind: BackupCiphertext['kind'];
  curve: BackupCiphertext['curve'];
  scheme: BackupCiphertext['scheme'];
  keyId: string;
  threshold: number;
  shareCount: number;
  label: string;
  blob: string;
}

interface BackupAckPayload {
  type: typeof BACKUP_ACK_MESSAGE_TYPE;
  keyId: string;
  sessionId?: string;
  status?: 'ok' | 'error';
  error?: string;
}

export interface UploadCoordinatorBackupOptions {
  transport: Transport;
  sessionId: string;
  keyId: string;
  backup: DeviceBackupArtifacts;
  timeoutMs?: number;
  shareIndex?: number;
}

type RawSendCapableTransport = Transport & {
  __maanySendText?: (payload: string) => Promise<void>;
};

export async function uploadCoordinatorBackupFragment(options: UploadCoordinatorBackupOptions): Promise<void> {
  const { transport, sessionId, keyId, backup } = options;
  if (!backup || !Array.isArray(backup.shares) || backup.shares.length === 0) {
    console.warn('[maany-sdk] no backup fragments available to upload');
    return;
  }
  const shareIndex = options.shareIndex ?? 0;
  const share = backup.shares[shareIndex];
  if (!share) {
    console.warn('[maany-sdk] missing coordinator backup fragment at index', shareIndex);
    return;
  }

  const shareHex = hexFromBytes(share);
  const payload: BackupUploadPayload = {
    type: BACKUP_UPLOAD_MESSAGE_TYPE,
    sessionId,
    keyId,
    ciphertext: encodeBackupCiphertext(backup.ciphertext),
    share: shareHex,
    fragment: shareHex,
    shareIndex,
  };
  payload.ciphertext.keyId = keyId;
  console.log('[maany-sdk] backup: outgoing payload', payload);
  const frameText = JSON.stringify(payload);
  console.log('[maany-sdk] uploading coordinator backup fragment', {
    sessionId,
    keyId,
    shareIndex,
    shareLength: share.length,
  });
  await sendFrame(transport, frameText);
  await waitForBackupAck(transport, { keyId, timeoutMs: options.timeoutMs ?? BACKUP_UPLOAD_TIMEOUT_MS });
  console.log('[maany-sdk] coordinator backup fragment delivered', { sessionId, keyId });
}

function encodeBackupCiphertext(ciphertext: BackupCiphertext): EncodedBackupCiphertext {
  return {
    kind: ciphertext.kind,
    curve: ciphertext.curve,
    scheme: ciphertext.scheme,
    keyId: hexFromBytes(ciphertext.keyId),
    threshold: ciphertext.threshold,
    shareCount: ciphertext.shareCount,
    label: ciphertext.label ? hexFromBytes(ciphertext.label) : '',
    blob: hexFromBytes(ciphertext.blob),
  };
}

async function waitForBackupAck(
  transport: Transport,
  { keyId, timeoutMs }: { keyId: string; timeoutMs: number }
): Promise<void> {
  const started = Date.now();
  console.log('[maany-sdk] waiting for coordinator backup ack', { keyId, timeoutMs });
  while (Date.now() - started < timeoutMs) {
    const frame = await transport.receive('device');
    if (!frame) {
      await delay(50);
      continue;
    }
    const ack = parseBackupAck(frame);
    if (!ack) {
      continue;
    }
    if (ack.keyId === keyId && ack.type === BACKUP_ACK_MESSAGE_TYPE) {
      if (ack.status && ack.status !== 'ok') {
        throw new Error(ack.error ?? 'Coordinator rejected backup fragment');
      }
      return;
    }
  }
  throw new Error('Timed out waiting for coordinator backup acknowledgement');
}

async function sendFrame(transport: Transport, payload: string): Promise<void> {
  const textSender = (transport as RawSendCapableTransport).__maanySendText;
  if (textSender) {
    console.log('[maany-sdk] backup: sending fragment via raw WebSocket channel');
    await textSender(payload);
    return;
  }
  console.log('[maany-sdk] backup: sending fragment via transport queue fallback');
  await transport.send({ participant: 'server', payload: bytesFromUtf8(payload) });
}

function parseBackupAck(frame: Uint8Array): BackupAckPayload | null {
  try {
    const text = utf8FromBytes(frame);
    const parsed = JSON.parse(text);
    if (parsed && parsed.type === BACKUP_ACK_MESSAGE_TYPE && typeof parsed.keyId === 'string') {
      return parsed as BackupAckPayload;
    }
  } catch (error) {
    console.debug('[maany-sdk] non-JSON control frame while waiting for backup ack', error);
  }
  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
