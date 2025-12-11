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
  BroadcastMode,
  CreateKeyOptions,
  CreateKeyResult,
  GasPriceConfig,
  MaanyWallet,
  WalletMsgSendOptions,
  WalletMsgSendResult,
  WalletOptions,
  WalletSignCosmosOptions,
  WalletSignOptions,
  WalletStorageOption,
  RecoverKeyOptions,
  RecoverKeyResult,
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
import {
  JsonTransport,
  buildTxBody,
  buildAuthInfo,
  buildTxRaw,
  buildSecp256k1PubkeyAny,
  buildMsgSend,
  fetchBaseAccount,
  simulateTx,
  broadcastTx,
  pubkeyToAddress,
  type Coin,
} from './cosmos';

const DEFAULT_AUTH_TOKEN = 'dev-token';
const DEFAULT_BACKUP_SHARE_COUNT = 3;
const DEFAULT_BACKUP_THRESHOLD = 2;
const DEFAULT_ADDRESS_PREFIX = 'maany';
const DEFAULT_GAS_PRICE: GasPriceConfig = { amount: '0.025', denom: 'uatom' };
const DEFAULT_GAS_ADJUSTMENT = 1.2;
const DEFAULT_BROADCAST_MODE: BroadcastMode = 'BROADCAST_MODE_SYNC';
const DEFAULT_GAS_ESTIMATE = 200_000;

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
  chainId?: string;
  addressPrefix: string;
  gasPrice: GasPriceConfig;
  gasAdjustment: number;
  broadcastMode: BroadcastMode;
  defaultGasLimit?: number;
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
  const gasPrice = normalizeGasPriceConfig(options.defaultGasPrice, DEFAULT_GAS_PRICE);
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
    chainId: options.chainId,
    addressPrefix: options.addressPrefix ?? DEFAULT_ADDRESS_PREFIX,
    gasPrice,
    gasAdjustment: options.gasAdjustment ?? DEFAULT_GAS_ADJUSTMENT,
    broadcastMode: options.broadcastMode ?? DEFAULT_BROADCAST_MODE,
    defaultGasLimit: options.defaultGasLimit,
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
      console.log('[maany-sdk] wallet: saving device share', { keyId });
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
      console.log('[maany-sdk] recovery: saving device share to storage');
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
    const messageBytes = cloneBytes(options.bytes);
    console.log('[maany-sdk] wallet: loading device share for', keyIdHex);
    const blob = await this.loadDeviceShare(keyIdHex);
    console.log('[maany-sdk] wallet: loaded device share bytes', blob.length);
    const connection = await connectToCoordinator({
      url: this.options.serverUrl,
      token,
      intent: 'sign',
      keyId: keyIdHex,
      message: cloneBytes(messageBytes),
    });
    const coordinator = withModeSupport(
      createCoordinator({ transport: connection.transport, storage: this.options.storage })
    );
    const ctx = coordinator.initContext();
    try {
      console.log('[maany-sdk] wallet: importing keypair');
      const keypair = mpc.kpImport(ctx, blob);
      console.log('[maany-sdk] wallet: keypair imported');
      let signature: Uint8Array | null = null;
      try {
        console.log('[maany-sdk] wallet: invoking coordinator.runSign');
        signature = await coordinator.runSign(ctx, keypair, null, {
          message: messageBytes,
          extraAad: options.extraAad ? cloneBytes(options.extraAad) : undefined,
          format: options.format,
          mode: 'device-only',
        });
        console.log('[maany-sdk] wallet: coordinator.runSign completed');
      } catch (error) {
        console.error('[maany-sdk] wallet: coordinator.runSign failed', error);
        throw error;
      }
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

  async signAndBroadcastMsgSend(options: WalletMsgSendOptions): Promise<WalletMsgSendResult> {
    if (!this.options.apiBaseUrl) {
      throw new Error('Coordinator API URL is not configured for Cosmos transactions');
    }
    const keyIdHex = options.keyId ? hexFromBytes(cloneBytes(options.keyId)) : await this.ensureKeyId();
    if (!keyIdHex) {
      throw new Error('signAndBroadcastMsgSend requires an existing wallet. Run createKey() first.');
    }
    if (!options.toAddress) {
      throw new Error('signAndBroadcastMsgSend requires a recipient address');
    }
    const toAddress = options.toAddress.trim();
    if (!toAddress) {
      throw new Error('Recipient address must be non-empty');
    }
    const chainId = options.chainId ?? this.options.chainId;
    if (!chainId) {
      throw new Error('chainId is required. Configure WalletOptions.chainId or pass it per request.');
    }
    if (!options.amount || !options.amount.denom || !options.amount.amount) {
      throw new Error('signAndBroadcastMsgSend requires an amount with denom and value');
    }
    const amountValue = options.amount.amount.trim();
    const amountDenom = options.amount.denom.trim();
    if (!amountValue || !amountDenom) {
      throw new Error('Amount denom and value must be non-empty');
    }
    const token = await this.resolveToken(options.token);
    console.log('[maany-sdk] wallet: starting signAndBroadcastMsgSend', {
      toAddress,
      amount: amountValue,
      denom: amountDenom,
      chainId,
      keyId: keyIdHex,
    });
    const transport = this.createTransport(token);
    const keyMaterial = await this.deriveKeyMaterial(keyIdHex);
    const providedFrom = options.fromAddress?.trim();
    const normalizedFrom = providedFrom ?? keyMaterial.address;
    if (providedFrom && providedFrom !== keyMaterial.address) {
      throw new Error('Provided fromAddress does not match the wallet key');
    }
    console.log('[maany-sdk] wallet: resolved signer address', normalizedFrom);
    const account = await fetchBaseAccount(transport, normalizedFrom);
    console.log('[maany-sdk] wallet: fetched base account', account);
    const message = buildMsgSend({
      fromAddress: normalizedFrom,
      toAddress,
      amount: [{ denom: amountDenom, amount: amountValue }],
    });
    const bodyBytes = buildTxBody({ messages: [message], memo: options.memo });
    const gasPrice = normalizeGasPriceConfig(options.gasPrice, this.options.gasPrice);
    const gasAdjustment = options.gasAdjustment ?? this.options.gasAdjustment;
    const signerPublicKey = buildSecp256k1PubkeyAny(keyMaterial.compressed);
    let gasLimit: bigint;
    let gasUsedValue = 0;
    let gasWantedValue = 0;
    if (options.gasLimit ?? this.options.defaultGasLimit) {
      const provided = options.gasLimit ?? this.options.defaultGasLimit ?? 200_000;
      console.log('[maany-sdk] wallet: using manual gas limit', provided);
      gasLimit = calculateGasLimit(provided, gasAdjustment);
      gasUsedValue = provided;
      gasWantedValue = provided;
    } else {
      const simulateAuthInfo = buildAuthInfo({
        sequence: account.sequence,
        publicKey: signerPublicKey,
        gasLimit: '0',
        feeAmount: [{ denom: gasPrice.denom, amount: '0' }],
      });
      const simulateTxBytes = buildTxRaw({
        bodyBytes,
        authInfoBytes: simulateAuthInfo,
        signatures: [new Uint8Array(64)],
      });
      console.log('[maany-sdk] wallet: simulating transaction');
      const gasEstimate = await simulateTx(transport, simulateTxBytes);
      console.log('[maany-sdk] wallet: gas estimate', gasEstimate);
      const rawGas = gasEstimate.recommended || gasEstimate.gasWanted || gasEstimate.gasUsed;
      console.log('[maany-sdk] wallet: raw gas before clamp', { rawGas, gasAdjustment });
      gasLimit = calculateGasLimit(Math.min(rawGas, 500_000), gasAdjustment);
      gasUsedValue = gasEstimate.gasUsed;
      gasWantedValue = gasEstimate.gasWanted;
    }
    const gasLimitString = gasLimit.toString();
    const feeAmountValue = multiplyGasPrice(gasPrice.amount, gasLimit);
    const feeCoin: Coin = { denom: gasPrice.denom, amount: feeAmountValue };
    const authInfoBytes = buildAuthInfo({
      sequence: account.sequence,
      publicKey: signerPublicKey,
      gasLimit: gasLimitString,
      feeAmount: [feeCoin],
    });
    const doc = {
      bodyBytes,
      authInfoBytes,
      chainId,
      accountNumber: account.accountNumber,
      sequence: account.sequence,
    };
    console.log('[maany-sdk] sign: sign-doc components', {
      chainId,
      accountNumber: account.accountNumber,
      sequence: account.sequence,
      bodyHex: hexFromBytes(bodyBytes),
      authHex: hexFromBytes(authInfoBytes),
    });
    console.log('[maany-sdk] wallet: signing sign doc');
    const signatureResult = await this.signCosmos({
      doc,
      keyId: options.keyId,
      extraAad: options.extraAad,
      format: options.format,
      token: options.token,
      prehash: options.prehash,
    });
    console.log('[maany-sdk] wallet: signature produced');
    const txRawBytes = buildTxRaw({
      bodyBytes,
      authInfoBytes,
      signatures: [signatureResult.signature],
    });
    const broadcastMode = options.broadcastMode ?? this.options.broadcastMode;
    console.log('[maany-sdk] wallet: broadcasting transaction', { mode: broadcastMode });
    const broadcastResult = await broadcastTx(transport, txRawBytes, broadcastMode);
    console.log('[maany-sdk] wallet: broadcast result', broadcastResult);
    return {
      ...signatureResult,
      txhash: broadcastResult.txhash,
      height: broadcastResult.height,
      rawLog: broadcastResult.rawLog,
      code: broadcastResult.code,
      txRawBytes,
      gasUsed: gasUsedValue,
      gasWanted: gasWantedValue,
      gasLimit: gasLimitString,
      fee: feeCoin,
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

  private createTransport(token?: string): JsonTransport {
    if (!this.options.apiBaseUrl) {
      throw new Error('Coordinator API URL is not configured');
    }
    const headers = token
      ? {
          'content-type': 'application/json',
          Authorization: `Bearer ${token}`,
        }
      : undefined;
    return new JsonTransport({ baseUrl: this.options.apiBaseUrl, defaultHeaders: headers });
  }

  private async deriveKeyMaterial(
    keyIdHex: string,
  ): Promise<{ address: string; compressed: Uint8Array }> {
    const blob = await this.loadDeviceShare(keyIdHex);
    const ctx = mpc.init();
    try {
      const keypair = mpc.kpImport(ctx, blob);
      const pubkey = mpc.kpPubkey(ctx, keypair);
      mpc.kpFree(keypair);
      if (!pubkey?.compressed) {
        throw new Error('Unable to derive wallet public key');
      }
      const compressed = cloneBytes(pubkey.compressed);
      const address = pubkeyToAddress(compressed, this.options.addressPrefix);
      return { address, compressed };
    } finally {
      mpc.shutdown(ctx);
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
    const cloned = cloneBytes(record.blob);
    console.log('[maany-sdk] wallet: loaded device share from storage', {
      keyId,
      bytes: cloned.length,
      hex: hexFromBytes(cloned),
    });
    return cloned;
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

function normalizeGasPriceConfig(
  input: GasPriceConfig | undefined,
  fallback: GasPriceConfig,
): GasPriceConfig {
  const source = input ?? fallback;
  const amount = source.amount?.trim();
  const denom = source.denom?.trim();
  if (!amount) {
    throw new Error('Gas price amount must be provided');
  }
  if (!denom) {
    throw new Error('Gas price denom must be provided');
  }
  return { amount, denom };
}

function calculateGasLimit(estimate: number | undefined, gasAdjustment: number): bigint {
  const safeEstimate = typeof estimate === 'number' && Number.isFinite(estimate) && estimate > 0
    ? estimate
    : DEFAULT_GAS_ESTIMATE;
  const adjusted = Math.max(1, Math.ceil(safeEstimate * gasAdjustment));
  return BigInt(adjusted);
}

function multiplyGasPrice(amount: string, gasLimit: bigint): string {
  const { numerator, denominator } = parseDecimalString(amount);
  const product = numerator * gasLimit;
  return ((product + denominator - 1n) / denominator).toString();
}

function parseDecimalString(value: string): { numerator: bigint; denominator: bigint } {
  const normalized = value.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error(`Invalid decimal string: ${value}`);
  }
  const [whole, fractional = ''] = normalized.split('.');
  const digits = fractional.replace(/[^0-9]/g, '');
  const numerator = BigInt(`${whole}${digits}`);
  const denominator = BigInt(10) ** BigInt(digits.length);
  return {
    numerator,
    denominator: denominator === 0n ? 1n : denominator,
  };
}
