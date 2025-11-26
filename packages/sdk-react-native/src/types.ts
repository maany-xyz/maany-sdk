import type * as mpc from '@maanyio/mpc-rn-bare';
import type {
  Coordinator,
  CoordinatorOptions,
  DeviceBackupOptions,
  DeviceBackupArtifacts,
  ShareStorage,
  Transport,
} from '@maanyio/mpc-coordinator-rn';

export type WalletStatus = 'idle' | 'connecting' | 'ready' | 'locked' | 'error';

export interface ConnectOptions {
  /** Optional session identifier forwarded to the MPC coordinator. */
  sessionId?: Uint8Array;
  /** Optional key identifier forwarded to the MPC coordinator. */
  keyId?: Uint8Array;
  /** Arbitrary metadata (auth token, headers, etc.) you might need later. */
  authToken?: string;
  /** Force server-only or device-only behavior when supported. */
  mode?: 'device-only' | 'dual';
  /** Configure device backup fragment generation. */
  backup?: DeviceBackupOptions;
}

export interface SignOptions {
  bytes: Uint8Array;
  extraAad?: Uint8Array;
  format?: mpc.SignatureFormat;
}

export interface SignDoc {
  chainId: string;
  accountNumber: string;
  sequence: string;
  bodyBytes: Uint8Array;
  authInfoBytes: Uint8Array;
}

export interface SignCosmosDocOptions {
  doc: SignDoc;
  /** When true (default) the doc bytes are hashed with SHA-256 before signing. */
  prehash?: boolean;
  extraAad?: Uint8Array;
  format?: mpc.SignatureFormat;
}

export interface SignResult {
  signature: Uint8Array;
  format: mpc.SignatureFormat;
}

export interface SignCosmosDocResult extends SignResult {
  digest: Uint8Array;
  bodyBytes: Uint8Array;
}

export interface WalletEvents {
  onStatus(handler: (status: WalletStatus) => void): () => void;
  onAddress(handler: (address: string | null) => void): () => void;
  onError(handler: (error: unknown) => void): () => void;
}

export interface ReactNativeWalletAdapter extends WalletEvents {
  init(): Promise<void>;
  connect(options?: ConnectOptions): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): WalletStatus;
  getAddress(): Promise<string | null>;
  sign(options: SignOptions): Promise<SignResult>;
  signCosmosDoc(options: SignCosmosDocOptions): Promise<SignCosmosDocResult>;
}

export interface AddressResolverContext {
  ctx: mpc.Ctx;
  keypair: mpc.Keypair;
}

export interface ReactNativeWalletAdapterOptions {
  /** Provide an existing coordinator or let the adapter create one. */
  coordinator?: Coordinator;
  /** Create the coordinator from raw pieces when a prebuilt instance is not provided. */
  transport?: Transport;
  storage?: ShareStorage;
  coordinatorOptions?: Omit<CoordinatorOptions, 'transport' | 'storage'>;
  /** Optionally override how the MPC context is created. */
  makeContext?: () => mpc.Ctx;
  /** Resolve an address (string) from the device keypair's public key. */
  deriveAddress?: (ctx: AddressResolverContext) => Promise<string | null> | string | null;
  /** Namespace used to persist the active key identifier. */
  metadataKey?: string;
  /** Default signature encoding format (defaults to DER). */
  defaultSignatureFormat?: mpc.SignatureFormat;
  /** Custom session id factory used during DKG when one is not provided. */
  sessionIdFactory?: () => Uint8Array;
}

export type WalletStorageOption =
  | 'memory'
  | 'secure'
  | ShareStorage
  | { kind: 'memory' }
  | { kind: 'secure'; promptMessage?: string };

export interface WalletOptions {
  serverUrl?: string;
  apiBaseUrl?: string;
  authToken?: string;
  tokenFactory?: () => Promise<string | undefined> | string | undefined;
  storage?: WalletStorageOption;
  sessionIdFactory?: () => Uint8Array;
  backup?: DeviceBackupOptions;
  backupUploadUrl?: string;
  backupUploadToken?: string;
  backupUploadShareIndex?: number;
}

export interface CreateKeyOptions {
  token?: string;
  sessionId?: string | Uint8Array;
  sessionIdHint?: string;
  keyId?: Uint8Array;
  backup?: DeviceBackupOptions;
}

export interface CreateKeyResult {
  keyId: string;
  sessionId: string;
  recovery?: DeviceBackupArtifacts;
}

export interface MaanyWallet {
  createKey(options?: CreateKeyOptions): Promise<CreateKeyResult>;
}
