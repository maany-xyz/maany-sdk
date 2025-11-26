import * as mpc from '@maanyio/mpc-rn-bare';
import {
  Coordinator,
  InMemoryShareStorage,
  createCoordinator,
  makeSignBytes,
  pubkeyToCosmosAddress,
  sha256,
} from '@maanyio/mpc-coordinator-rn';
import type { ShareStorage } from '@maanyio/mpc-coordinator-rn';
import { bytesFromUtf8, hexFromBytes, utf8FromBytes, cloneBytes } from './bytes';
import { randomBytes } from './random';
import { withModeSupport, CoordinatorWithMode } from './coordinator';
import { uploadCoordinatorBackupFragment } from './backup';
import type {
  AddressResolverContext,
  ConnectOptions,
  ReactNativeWalletAdapter,
  ReactNativeWalletAdapterOptions,
  SignCosmosDocOptions,
  SignCosmosDocResult,
  SignOptions,
  SignResult,
  WalletStatus,
} from './types';

interface NormalizedOptions {
  coordinator: CoordinatorWithMode;
  storage: ShareStorage;
  metadataKey: string;
  defaultSignatureFormat: mpc.SignatureFormat;
  deriveAddress: (ctx: AddressResolverContext) => Promise<string | null> | string | null;
  sessionIdFactory: () => Uint8Array;
  makeContext: () => mpc.Ctx;
}

type ExtendedMpc = typeof mpc & {
  kpImport?: (ctx: mpc.Ctx, blob: Uint8Array) => mpc.Keypair;
  kpGetPubkeyCompressed?: (ctx: mpc.Ctx, keypair: mpc.Keypair) => Uint8Array;
  kpGetPubkey?: (ctx: mpc.Ctx, keypair: mpc.Keypair) => Uint8Array;
};

const mpcExtended = mpc as ExtendedMpc;

class ReactNativeWalletAdapterImpl implements ReactNativeWalletAdapter {
  private ctx: mpc.Ctx | null = null;
  private status: WalletStatus = 'idle';
  private address: string | null = null;
  private readonly statusSubscribers = new Set<(status: WalletStatus) => void>();
  private readonly addressSubscribers = new Set<(address: string | null) => void>();
  private readonly errorSubscribers = new Set<(error: unknown) => void>();
  private deviceKeypair: mpc.Keypair | null = null;
  private serverKeypair: mpc.Keypair | null = null;
  private serverShareRemote = false;
  private currentKeyId: string | null = null;
  private connectPromise?: Promise<void>;

  constructor(private readonly options: NormalizedOptions) {}

  async init(): Promise<void> {
    this.ensureContext();
    try {
      const keyId = await this.loadPersistedKeyId();
      if (!keyId) {
        this.emitStatus('idle');
        return;
      }
      const restored = await this.restoreKeypairs(keyId);
      if (!restored) {
        this.emitStatus('idle');
      }
    } catch (error: unknown) {
      this.emitStatus('locked');
      this.emitError(error);
    }
  }

  getStatus(): WalletStatus {
    return this.status;
  }

  async getAddress(): Promise<string | null> {
    return this.address;
  }

  async connect(connectOptions: ConnectOptions = {}): Promise<void> {
    if (this.status === 'ready') {
      return;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }
    this.emitStatus('connecting');
    const ctx = this.ensureContext();
    const sessionId = connectOptions.sessionId ? cloneBytes(connectOptions.sessionId) : this.options.sessionIdFactory();
    const sessionIdHex = hexFromBytes(sessionId);
    const keyId = connectOptions.keyId ? cloneBytes(connectOptions.keyId) : undefined;
    const providedKeyIdHex = keyId ? hexFromBytes(keyId) : undefined;
    const mode = connectOptions.mode ?? 'device-only';

    const coordinator = this.options.coordinator;
    console.log('[maany-sdk] connect(): starting DKG', {
      mode,
      hasKeyId: Boolean(keyId),
      sessionId: sessionIdHex,
    });
    const connectPromise = coordinator
      .runDkg(ctx, { sessionId, keyId, mode, backup: connectOptions.backup })
      .then(async ({ deviceKeypair, serverKeypair, backup }) => {
        const exported = mpc.kpExport(ctx, deviceKeypair);
        const computedKeyId = providedKeyIdHex ?? hexFromBytes(exported);
        if (backup) {
          console.log('[maany-sdk] adapter: received device backup artifacts', {
            shareCount: backup.shares.length,
            ciphertextKind: backup.ciphertext.kind,
          });
          try {
            await uploadCoordinatorBackupFragment({
              transport: coordinator.options.transport,
              sessionId: sessionIdHex,
              keyId: computedKeyId,
              backup,
            });
          } catch (error) {
            console.warn('[maany-sdk] adapter: failed to upload coordinator backup fragment', error);
          }
        } else {
          console.log('[maany-sdk] adapter: coordinator returned no backup artifacts');
        }
        this.deviceKeypair = deviceKeypair;
        this.serverKeypair = serverKeypair ?? null;
        this.serverShareRemote = !serverKeypair;
        await this.persistKeyId(computedKeyId);
        this.currentKeyId = computedKeyId;
        const address = await this.resolveAddress();
        this.address = address;
        this.emitAddress(address);
        this.emitStatus('ready');
        console.log('[maany-sdk] connect(): DKG complete', {
          mode,
          sessionId: sessionIdHex,
          keyId: computedKeyId,
        });
      })
      .catch((error: unknown) => {
        this.emitStatus('error');
        this.emitError(error);
        console.warn('[maany-sdk] connect(): DKG failed', error);
        throw error;
      })
      .finally(() => {
        this.connectPromise = undefined;
      });

    this.connectPromise = connectPromise;
    return connectPromise;
  }

  async disconnect(): Promise<void> {
    await this.clearPersistedShares();
    this.deviceKeypair = null;
    this.serverKeypair = null;
    this.serverShareRemote = false;
    this.currentKeyId = null;
    this.address = null;
    this.emitAddress(null);
    this.emitStatus('idle');
  }

  async sign(options: SignOptions): Promise<SignResult> {
    const ctx = this.ensureContext();
    if (!this.deviceKeypair) {
      throw new Error('Wallet adapter is not ready. Call connect() first.');
    }
    if (!this.serverKeypair && !this.serverShareRemote) {
      throw new Error('Server key material is unavailable. Run DKG again.');
    }
    const signature = await this.options.coordinator.runSign(
      ctx,
      this.deviceKeypair,
      this.serverKeypair,
      {
        message: cloneBytes(options.bytes),
        extraAad: options.extraAad ? cloneBytes(options.extraAad) : undefined,
        format: options.format ?? this.options.defaultSignatureFormat,
        mode: this.serverShareRemote ? 'device-only' : undefined,
      }
    );
    if (!signature) {
      throw new Error('Coordinator did not produce a signature');
    }
    return {
      signature,
      format: options.format ?? this.options.defaultSignatureFormat,
    };
  }

  async signCosmosDoc(options: SignCosmosDocOptions): Promise<SignCosmosDocResult> {
    const body = makeSignBytes(options.doc);
    const digest = options.prehash === false ? body : sha256(body);
    const res = await this.sign({ bytes: digest, extraAad: options.extraAad, format: options.format });
    return {
      ...res,
      digest,
      bodyBytes: body,
    };
  }

  onStatus(handler: (status: WalletStatus) => void): () => void {
    this.statusSubscribers.add(handler);
    handler(this.status);
    return () => this.statusSubscribers.delete(handler);
  }

  onAddress(handler: (address: string | null) => void): () => void {
    this.addressSubscribers.add(handler);
    handler(this.address);
    return () => this.addressSubscribers.delete(handler);
  }

  onError(handler: (error: unknown) => void): () => void {
    this.errorSubscribers.add(handler);
    return () => this.errorSubscribers.delete(handler);
  }

  private ensureContext(): mpc.Ctx {
    if (!this.ctx) {
      this.ctx = this.options.makeContext();
    }
    return this.ctx;
  }

  private async resolveAddress(): Promise<string | null> {
    if (!this.deviceKeypair) {
      return null;
    }
    const ctx = this.ensureContext();
    try {
      const address = await this.options.deriveAddress({ ctx, keypair: this.deviceKeypair });
      return address;
    } catch (error: unknown) {
      this.emitError(error);
      return null;
    }
  }

  private async persistKeyId(keyId: string): Promise<void> {
    const payload = bytesFromUtf8(keyId);
    await this.options.storage.save({ keyId: this.options.metadataKey, blob: payload });
  }

  private async loadPersistedKeyId(): Promise<string | null> {
    const record = await this.options.storage.load(this.options.metadataKey);
    if (!record) {
      return null;
    }
    return utf8FromBytes(record.blob);
  }

  private async restoreKeypairs(keyId: string): Promise<boolean> {
    const [deviceShare, serverShare] = await Promise.all([
      this.options.storage.load(keyId),
      this.options.storage.load(`${keyId}:server`),
    ]);
    if (!deviceShare) {
      return false;
    }
    const ctx = this.ensureContext();
    if (typeof mpcExtended.kpImport !== 'function') {
      this.emitError(new Error('mpc.kpImport is not available – cannot restore persisted shares.'));
      return false;
    }
    this.deviceKeypair = mpcExtended.kpImport(ctx, deviceShare.blob);
    this.serverKeypair = serverShare ? mpcExtended.kpImport(ctx, serverShare.blob) : null;
    this.serverShareRemote = !serverShare;
    this.currentKeyId = keyId;
    const address = await this.resolveAddress();
    this.address = address;
    this.emitAddress(address);
    this.emitStatus('ready');
    return true;
  }

  private async clearPersistedShares(): Promise<void> {
    const keyId = this.currentKeyId ?? (await this.loadPersistedKeyId());
    if (!keyId) {
      return;
    }
    await Promise.all([
      this.options.storage.remove(keyId),
      this.options.storage.remove(`${keyId}:server`),
      this.options.storage.remove(this.options.metadataKey),
    ]);
  }

  private emitStatus(status: WalletStatus): void {
    this.status = status;
    this.statusSubscribers.forEach((cb) => cb(status));
  }

  private emitAddress(address: string | null): void {
    this.address = address;
    this.addressSubscribers.forEach((cb) => cb(address));
  }

  private emitError(error: unknown): void {
    this.errorSubscribers.forEach((cb) => cb(error));
  }
}

function normalizeOptions(options: ReactNativeWalletAdapterOptions): NormalizedOptions {
  const storage = options.storage ?? new InMemoryShareStorage();
  let coordinator = options.coordinator;
  if (!coordinator) {
    if (!options.transport) {
      throw new Error('ReactNativeWalletAdapter requires either a coordinator or a transport.');
    }
    coordinator = createCoordinator({
      transport: options.transport,
      storage,
      ...(options.coordinatorOptions ?? {}),
    });
  }
  const coordinatorWithMode = withModeSupport(coordinator);
  const deriveAddress = options.deriveAddress ?? ((ctx: AddressResolverContext) => {
    const pubkey = getPubkey(ctx);
    if (!pubkey) {
      return null;
    }
    return pubkeyToCosmosAddress(pubkey);
  });

  return {
    coordinator: coordinatorWithMode,
    storage,
    metadataKey: options.metadataKey ?? 'maany:wallet:key-id',
    defaultSignatureFormat: options.defaultSignatureFormat ?? 'der',
    deriveAddress,
    sessionIdFactory: options.sessionIdFactory ?? (() => randomBytes(32)),
    makeContext: options.makeContext ?? (() => coordinator!.initContext()),
  };
}

function getPubkey({ ctx, keypair }: AddressResolverContext): Uint8Array | null {
  if (typeof mpcExtended.kpGetPubkeyCompressed === 'function') {
    return cloneBytes(mpcExtended.kpGetPubkeyCompressed(ctx, keypair));
  }
  if (typeof mpcExtended.kpGetPubkey === 'function') {
    return cloneBytes(mpcExtended.kpGetPubkey(ctx, keypair));
  }
  return null;
}

export function createReactNativeWalletAdapter(options: ReactNativeWalletAdapterOptions): ReactNativeWalletAdapter {
  const normalized = normalizeOptions(options);
  return new ReactNativeWalletAdapterImpl(normalized);
}
