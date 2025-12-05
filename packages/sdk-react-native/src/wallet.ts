import * as mpc from '@maanyio/mpc-rn-bare';
import {
  DeviceBackupOptions,
  BackupCiphertext,
  InMemoryShareStorage,
  SecureShareStorage,
  ShareStorage,
  createCoordinator,
} from '@maanyio/mpc-coordinator-rn';
import { connectToCoordinator } from './connection';
import {
  CreateKeyOptions,
  CreateKeyResult,
  MaanyWallet,
  WalletOptions,
  WalletStorageOption,
  RecoverKeyOptions,
  RecoverKeyResult,
  WalletSignOptions,
  WalletSignCosmosOptions,
  SignCosmosDocResult,
  SignResult,
} from './types';
import { bytesFromHex, bytesFromUtf8, utf8FromBytes, cloneBytes, hexFromBytes } from './bytes';
import { randomBytes } from './random';
import { readEnv } from './env';
import { withModeSupport } from './coordinator';
import { uploadCoordinatorBackupFragment } from './backup';
import { persistDeviceBackupLocally, loadPersistedDeviceBackup } from './backup-storage';
import { uploadThirdPartyBackupFragment } from './backup-upload';
import { fetchCoordinatorRecoveryArtifact, fetchThirdPartyRecoveryFragment } from './recovery';
import { resolveApiBaseUrl, walletExistsRemotely } from './api';
import { buildSignDoc, hashSignDoc } from '@maany/cosmos-sign-doc';

const DEFAULT_AUTH_TOKEN = 'dev-token';
const DEFAULT_BACKUP_SHARE_COUNT = 3;
const DEFAULT_BACKUP_THRESHOLD = 2;

interface NormalizedWalletOptions {
  serverUrl?: string;
  apiBaseUrl?: string;
  storage: ShareStorage;
  sessionIdFactory: () => Uint8Array;
  token?: string;
  tokenFactory?: () => Promise<string | undefined> | string | undefined;
  backup?: DeviceBackupOptions;
  backupUpload?: BackupUploadConfig | null;
  metadataKey: string;
}

interface BackupUploadConfig {
  url: string;
  token?: string;
  shareIndex?: number;
}

export function createMaanyWallet(options: WalletOptions = {}): MaanyWallet {
  const storage = resolveStorage(options.storage);
  const apiBaseUrl = resolveApiBaseUrl(options.apiBaseUrl, options.serverUrl);
  const backupUpload = resolveBackupUpload(options);
  const normalized: NormalizedWalletOptions = {
    serverUrl: options.serverUrl,
    apiBaseUrl,
    storage,
    sessionIdFactory: options.sessionIdFactory ?? (() => randomBytes(16)),
    token: options.authToken ?? readEnv('EXPO_PUBLIC_MPC_AUTH_TOKEN', 'MAANY_MPC_AUTH_TOKEN') ?? DEFAULT_AUTH_TOKEN,
    tokenFactory: options.tokenFactory,
    backup: options.backup,
    backupUpload,
    metadataKey: options.metadataKey ?? 'maany:wallet:key-id',
  };
  return new DefaultMaanyWallet(normalized);
}

class DefaultMaanyWallet implements MaanyWallet {
  constructor(private readonly options: NormalizedWalletOptions) {}

  async createKey(options: CreateKeyOptions = {}): Promise<CreateKeyResult> {
    const token = await this.resolveToken(options.token);
    const session = normalizeSessionId(options.sessionId, this.options.sessionIdFactory);
    const providedKeyIdHex = options.keyId ? hexFromBytes(options.keyId) : undefined;
    if (providedKeyIdHex) {
      const remoteExists = await this.checkRemoteWallet(providedKeyIdHex, token);
      if (remoteExists === true) {
        throw new Error('Wallet already exists remotely. Start the recovery flow instead of createKey().');
      }
    }

    const connection = await connectToCoordinator({
      url: this.options.serverUrl,
      token,
      intent: 'dkg',
      sessionId: session.hex,
      sessionIdHint: options.sessionIdHint ?? session.hex,
      keyId: providedKeyIdHex,
    });

    const coordinator = withModeSupport(
      createCoordinator({
        transport: connection.transport,
        storage: this.options.storage,
      })
    );
    const ctx = coordinator.initContext();
    try {
      const backupOptions = resolveBackupOptions(session.bytes, options.backup, this.options.backup);
      console.log('[maany-sdk] wallet: resolved backup options', backupOptions ?? null);
      const { deviceKeypair, serverKeypair, backup } = await coordinator.runDkg(ctx, {
        sessionId: session.bytes,
        keyId: options.keyId,
        mode: 'device-only',
        backup: backupOptions,
      });
      const deviceBlob = mpc.kpExport(ctx, deviceKeypair);
      const keyId = providedKeyIdHex ?? hexFromBytes(deviceBlob);
      await this.options.storage.save({ keyId, blob: cloneBytes(deviceBlob) });
      await this.persistKeyIdentifier(keyId);
      if (backup) {
        console.log('[maany-sdk] wallet: received device backup artifacts', {
          shareCount: backup.shares.length,
          ciphertextKind: backup.ciphertext.kind,
        });
        try {
          await uploadCoordinatorBackupFragment({
            transport: connection.transport,
            sessionId: connection.sessionId,
            keyId,
            backup,
          });
        } catch (error) {
          console.warn('[maany-sdk] wallet: failed to upload coordinator backup fragment', error);
        }
        await persistDeviceBackupLocally({ storage: this.options.storage, keyId, backup });
        if (this.options.backupUpload?.url) {
          try {
            await uploadThirdPartyBackupFragment({
              baseUrl: this.options.backupUpload.url,
              token: this.options.backupUpload.token,
              shareIndex: this.options.backupUpload.shareIndex,
              walletId: keyId,
              backup,
            });
          } catch (error) {
            console.warn('[maany-sdk] wallet: failed to upload third-party backup fragment', error);
          }
        }
      } else {
        console.warn('[maany-sdk] wallet: coordinator did not produce backup artifacts');
      }
      mpc.kpFree(deviceKeypair);
      if (serverKeypair) {
        mpc.kpFree(serverKeypair);
      }
      return { keyId, sessionId: connection.sessionId, recovery: backup ?? undefined };
    } finally {
      connection.close();
      mpc.shutdown(ctx);
    }
  }

  async recoverKey(options: RecoverKeyOptions): Promise<RecoverKeyResult> {
    if (!options.keyId) {
      throw new Error('recoverKey requires keyId');
    }
    if (!this.options.apiBaseUrl) {
      throw new Error('Coordinator API URL is not configured for recovery');
    }
    const keyIdHex = hexFromBytes(cloneBytes(options.keyId));
    const token = await this.resolveToken(options.token);
    const coordinatorArtifact = await fetchCoordinatorRecoveryArtifact({
      baseUrl: this.options.apiBaseUrl,
      walletId: keyIdHex,
      token,
    });
    console.log('[maany-sdk] recovery: fetched coordinator artifact', { keyId: keyIdHex });
    const localBackup = await loadPersistedDeviceBackup({ storage: this.options.storage, keyId: keyIdHex });
    const shares: Uint8Array[] = [coordinatorArtifact.fragment];
    if (localBackup && localBackup.shares.length > 0) {
      console.log('[maany-sdk] recovery: using locally persisted fragment');
      shares.push(localBackup.shares[0]);
    } else {
      if (!this.options.backupUpload?.url) {
        throw new Error('Third-party backup host is not configured for recovery');
      }
      const partnerShare = await fetchThirdPartyRecoveryFragment({
        baseUrl: this.options.backupUpload.url,
        walletId: keyIdHex,
        token: this.options.backupUpload.token ?? token,
      });
      console.log('[maany-sdk] recovery: fetched partner fragment');
      shares.push(partnerShare);
    }
    if (shares.length < 2) {
      throw new Error('Insufficient fragments to recover wallet');
    }
    const ctx = mpc.init();
    try {
      console.log('[maany-sdk] recovery: attempting backupRestore');
      const recovered = mpcWithBackup.backupRestore(ctx, coordinatorArtifact.ciphertext, shares);
      const deviceBlob = mpc.kpExport(ctx, recovered);
      console.log('[maany-sdk] recovery: recovered device share', hexFromBytes(deviceBlob));
      await this.options.storage.save({ keyId: keyIdHex, blob: cloneBytes(deviceBlob) });
      await this.persistKeyIdentifier(keyIdHex);
      mpc.kpFree(recovered);
      console.log('[maany-sdk] recovery: key restored and persisted');
      return { keyId: keyIdHex, restored: true };
    } finally {
      mpc.shutdown(ctx);
    }
  }

  async signBytes(options: WalletSignOptions): Promise<SignResult> {
    const keyIdHex = options.keyId ? hexFromBytes(cloneBytes(options.keyId)) : await this.ensureKeyId();
    if (!keyIdHex) {
      throw new Error('signBytes requires an existing wallet. Run createKey() first.');
    }
    const token = await this.resolveToken(options.token);
    const blob = await this.loadDeviceShare(keyIdHex);
    const connection = await connectToCoordinator({
      url: this.options.serverUrl,
      token,
      intent: 'sign',
      keyId: keyIdHex,
    });
    const coordinator = withModeSupport(
      createCoordinator({ transport: connection.transport, storage: this.options.storage })
    );
    const ctx = coordinator.initContext();
    try {
      const keypair = mpc.kpImport(ctx, blob);
      const signature = await coordinator.runSign(ctx, keypair, null, {
        message: cloneBytes(options.bytes),
        extraAad: options.extraAad ? cloneBytes(options.extraAad) : undefined,
        format: options.format,
        mode: 'device-only',
      });
      mpc.kpFree(keypair);
      if (!signature) {
        throw new Error('Coordinator did not produce a signature');
      }
      return {
        signature,
        format: options.format ?? 'der',
      };
    } finally {
      connection.close();
      mpc.shutdown(ctx);
    }
  }

  async signCosmos(options: WalletSignCosmosOptions): Promise<SignCosmosDocResult> {
    const signDocBytes = buildSignDoc({
      bodyBytes: options.doc.bodyBytes,
      authInfoBytes: options.doc.authInfoBytes,
      chainId: options.doc.chainId,
      accountNumber: options.doc.accountNumber,
    });
    const digest = options.prehash === false ? signDocBytes : hashSignDoc(signDocBytes);
    const result = await this.signBytes({
      keyId: options.keyId,
      bytes: digest,
      extraAad: options.extraAad,
      format: options.format,
      token: options.token,
    });
    return {
      ...result,
      digest,
      bodyBytes: options.doc.bodyBytes,
    };
  }

  private async checkRemoteWallet(keyId: string, token?: string): Promise<boolean | null> {
    if (!this.options.apiBaseUrl) {
      return null;
    }
    try {
      return await walletExistsRemotely({ baseUrl: this.options.apiBaseUrl, walletId: keyId, token });
    } catch (error) {
      console.warn('[maany-sdk] wallet: wallet lookup failed – proceeding without recovery hint', error);
      return null;
    }
  }

  private async resolveToken(override?: string): Promise<string | undefined> {
    if (override) {
      return override;
    }
    if (this.options.tokenFactory) {
      const value = await this.options.tokenFactory();
      if (value) {
        return value;
      }
    }
    return this.options.token;
  }

  private async persistKeyIdentifier(keyId: string): Promise<void> {
    try {
      await this.options.storage.save({ keyId: this.options.metadataKey, blob: bytesFromUtf8(keyId) });
    } catch (error) {
      console.warn('[maany-sdk] wallet: failed to persist metadata key', error);
    }
  }

  private async ensureKeyId(): Promise<string | null> {
    const record = await this.options.storage.load(this.options.metadataKey);
    if (!record) {
      return null;
    }
    return utf8FromBytes(record.blob);
  }

  private async loadDeviceShare(keyId: string): Promise<Uint8Array> {
    const record = await this.options.storage.load(keyId);
    if (!record) {
      throw new Error('Device key share not found. Run recoverKey or createKey first.');
    }
    return cloneBytes(record.blob);
  }
}

function resolveBackupUpload(options: WalletOptions): BackupUploadConfig | null {
  const url = options.backupUploadUrl ?? readEnv('EXPO_PUBLIC_MPC_BACKUP_URL', 'MAANY_MPC_BACKUP_URL');
  if (!url) {
    return null;
  }
  return {
    url,
    token: options.backupUploadToken ?? readEnv('EXPO_PUBLIC_MPC_BACKUP_TOKEN', 'MAANY_MPC_BACKUP_TOKEN'),
    shareIndex: options.backupUploadShareIndex,
  };
}

function resolveStorage(option?: WalletStorageOption): ShareStorage {
  if (!option || option === 'memory' || (isStorageConfig(option) && option.kind === 'memory')) {
    return new InMemoryShareStorage();
  }

  if (option === 'secure' || (isStorageConfig(option) && option.kind === 'secure')) {
    const promptMessage = typeof option === 'object' && 'promptMessage' in option ? option.promptMessage : undefined;
    try {
      return new SecureShareStorage(promptMessage ? { promptMessage } : undefined);
    } catch (error) {
      console.warn('[maany-sdk] SecureShareStorage unavailable, falling back to in-memory storage.', error);
      return new InMemoryShareStorage();
    }
  }

  if (isShareStorage(option)) {
    return option;
  }

  return new InMemoryShareStorage();
}

function isStorageConfig(option: WalletStorageOption): option is { kind: 'memory' } | { kind: 'secure'; promptMessage?: string } {
  return typeof option === 'object' && option !== null && 'kind' in option;
}

function isShareStorage(value: WalletStorageOption): value is ShareStorage {
  return typeof value === 'object' && value !== null && 'save' in value && typeof (value as ShareStorage).save === 'function';
}

function normalizeSessionId(
  input: string | Uint8Array | undefined,
  factory: () => Uint8Array
): { hex: string; bytes: Uint8Array } {
  if (input instanceof Uint8Array) {
    const cloned = new Uint8Array(input);
    return { hex: hexFromBytes(cloned), bytes: cloned };
  }
  if (typeof input === 'string' && input.length > 0) {
    const bytes = bytesFromHex(input);
    return { hex: hexFromBytes(bytes), bytes };
  }
  const bytes = factory();
  return { hex: hexFromBytes(bytes), bytes };
}

function resolveBackupOptions(
  sessionId: Uint8Array,
  override?: DeviceBackupOptions,
  fallback?: DeviceBackupOptions
): DeviceBackupOptions | undefined {
  const enabled = override?.enabled ?? fallback?.enabled;
  if (enabled === false) {
    return { enabled };
  }

  const shareCount = Math.max(
    1,
    override?.shareCount ?? fallback?.shareCount ?? DEFAULT_BACKUP_SHARE_COUNT
  );
  const rawThreshold = override?.threshold ?? fallback?.threshold ?? DEFAULT_BACKUP_THRESHOLD;
  const threshold = Math.min(shareCount, Math.max(1, rawThreshold));
  const labelSource = override?.label ?? fallback?.label ?? sessionId;
  const resolved: DeviceBackupOptions = {
    shareCount,
    threshold,
  };
  if (labelSource) {
    resolved.label = cloneBytes(labelSource);
  }
  if (typeof enabled === 'boolean') {
    resolved.enabled = enabled;
  }
  return resolved;
}
type BackupRestoreCapableMpc = typeof mpc & {
  backupRestore(ctx: mpc.Ctx, ciphertext: BackupCiphertext, shares: Uint8Array[]): mpc.Keypair;
};

const mpcWithBackup = mpc as BackupRestoreCapableMpc;
