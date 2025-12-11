import * as mpc from '@maanyio/mpc-rn-bare';
import type {
  BackupCiphertext,
  Coordinator,
  DeviceBackupArtifacts,
  DeviceBackupOptions,
} from '@maanyio/mpc-coordinator-rn';
import { runDkg as runDkgImpl } from '@maanyio/mpc-coordinator-rn/dist/session/dkg';
import { cloneBytes, optionalClone, toHex } from '@maanyio/mpc-coordinator-rn/dist/utils/bytes';
import { hexFromBytes } from './bytes';
import { derToCompactSignature } from './crypto/signature';

export interface CoordinatorRunDkgOptions {
  keyId?: Uint8Array;
  sessionId?: Uint8Array;
  mode?: 'dual' | 'device-only';
  backup?: DeviceBackupOptions;
}

export interface CoordinatorRunSignOptions {
  message: Uint8Array;
  sessionId?: Uint8Array;
  extraAad?: Uint8Array;
  format?: mpc.SignatureFormat;
  mode?: 'dual' | 'device-only';
}

export type CoordinatorWithMode = Coordinator & {
  runDkg(ctx: mpc.Ctx, opts?: CoordinatorRunDkgOptions): ReturnType<Coordinator['runDkg']>;
  runSign(
    ctx: mpc.Ctx,
    device: mpc.Keypair | null,
    server: mpc.Keypair | null,
    opts: CoordinatorRunSignOptions
  ): ReturnType<Coordinator['runSign']>;
};

interface ModeAwareCoordinator {
  __maanyModeSupport?: boolean;
}

type DkgImplOptions = Parameters<typeof runDkgImpl>[1];
type DkgImplResult = Awaited<ReturnType<typeof runDkgImpl>>;

type BackupCapableBinding = typeof mpc & {
  backupCreate(
    ctx: mpc.Ctx,
    kp: mpc.Keypair,
    options?: { threshold?: number; shareCount?: number; label?: Uint8Array }
  ): { ciphertext: BackupCiphertext; shares: Uint8Array[] };
};

const bindingWithBackup = mpc as BackupCapableBinding;

const MODE_SUPPORT_FLAG = '__maanyModeSupport' as const;

export function withModeSupport<T extends Coordinator>(coordinator: T): CoordinatorWithMode {
  const enhanced = coordinator as CoordinatorWithMode & ModeAwareCoordinator;
  if (enhanced[MODE_SUPPORT_FLAG]) {
    return enhanced;
  }

  enhanced.runDkg = function runDkgWithMode(ctx, extraOpts: CoordinatorRunDkgOptions = {}) {
    const opts: DkgImplOptions = {
      transport: enhanced.options.transport,
      storage: enhanced.options.storage,
      keyId: optionalClone(extraOpts.keyId),
      sessionId: optionalClone(extraOpts.sessionId),
      mode: extraOpts.mode,
      backup: extraOpts.backup,
    };
    if (extraOpts.mode === 'device-only') {
      return runDeviceOnlyDkg(ctx, opts);
    }
    return runDkgImpl(ctx, opts);
  };

  const baseRunSign = enhanced.runSign.bind(enhanced);
  enhanced.runSign = function runSignWithMode(ctx, device, server, signOpts: CoordinatorRunSignOptions) {
    if (signOpts?.mode === 'device-only') {
      if (!device) {
        throw new Error('Device keypair is required for device-only signing');
      }
      return runDeviceOnlySign(ctx, device, {
        transport: enhanced.options.transport,
        message: cloneBytes(signOpts.message),
        sessionId: optionalClone(signOpts.sessionId),
        extraAad: optionalClone(signOpts.extraAad),
        format: signOpts.format,
      });
    }
    if (!server) {
      throw new Error('Server keypair is required for dual-mode signing');
    }
    return baseRunSign(ctx, device, server, signOpts);
  };

  enhanced[MODE_SUPPORT_FLAG] = true;
  return enhanced;
}

async function runDeviceOnlyDkg(ctx: mpc.Ctx, opts: DkgImplOptions): Promise<DkgImplResult> {
  const dkgDevice = mpc.dkgNew(ctx, {
    role: 'device',
    keyId: optionalClone(opts.keyId),
    sessionId: optionalClone(opts.sessionId),
  });

  const waitForDeviceMessage = async (): Promise<Uint8Array> => {
    while (true) {
      const next = await opts.transport.receive('device');
      if (next) {
        return next;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };

  let inbound: Uint8Array | undefined;
  for (let i = 0; i < 512; ++i) {
    const res = await mpc.dkgStep(ctx, dkgDevice, inbound);
    inbound = undefined;
    if (res.outMsg) {
      await opts.transport.send({ participant: 'server', payload: res.outMsg });
    }
    if (res.done) {
      break;
    }
    inbound = await waitForDeviceMessage();
  }

  const deviceKeypair = mpc.dkgFinalize(ctx, dkgDevice);
  const serverKeypair: mpc.Keypair | null = null;

  if (opts.storage) {
    const deviceBlob = mpc.kpExport(ctx, deviceKeypair);
    const keyId = toHex(deviceBlob);
    await opts.storage.save({ keyId, blob: cloneBytes(deviceBlob) });
  }

  await drainTransportQueue(opts.transport, 'device');
  const backup = maybeCreateBackup(ctx, deviceKeypair, opts.backup);

  return { deviceKeypair, serverKeypair, backup };
}

interface DeviceOnlySignOptions {
  transport: DkgImplOptions['transport'];
  message: Uint8Array;
  sessionId?: Uint8Array;
  extraAad?: Uint8Array;
  format?: mpc.SignatureFormat;
}

async function runDeviceOnlySign(
  ctx: mpc.Ctx,
  device: mpc.Keypair,
  opts: DeviceOnlySignOptions
): Promise<Uint8Array> {
  const commonOpts: mpc.SignOptions = {};
  if (opts.sessionId) {
    commonOpts.sessionId = optionalClone(opts.sessionId);
  }
  if (opts.extraAad) {
    commonOpts.extraAad = optionalClone(opts.extraAad);
  }

  const signDevice = mpc.signNew(ctx, device, commonOpts);
  const message = cloneBytes(opts.message);
  console.log('[maany-sdk] sign: setting message bytes', { length: message.length, hex: hexFromBytes(message) });
  mpc.signSetMessage(ctx, signDevice, message);

  const waitForServerMessage = async (): Promise<Uint8Array> => {
    let attempts = 0;
    while (true) {
      const next = await opts.transport.receive('device');
      if (next) {
        return next;
      }
      attempts += 1;
      if (attempts % 200 === 0) {
        console.log('[maany-sdk] sign: still waiting for server payload', { attempts });
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };

  console.log('[maany-sdk] sign: starting device-only loop');
  let inbound: Uint8Array | undefined = await waitForServerMessage();
  console.log('[maany-sdk] sign: received initial server payload', { bytes: inbound.length });
  for (let i = 0; i < 512; ++i) {
    const res = await mpc.signStep(ctx, signDevice, inbound);
    inbound = undefined;
    if (res.outMsg) {
      console.log('[maany-sdk] sign: sending payload to server', { round: i, bytes: res.outMsg.length });
      await opts.transport.send({ participant: 'server', payload: res.outMsg });
    }
    if (res.done) {
      console.log('[maany-sdk] sign: signStep done at round', i);
      break;
    }
    console.log('[maany-sdk] sign: waiting for server payload', { round: i });
    inbound = await waitForServerMessage();
    console.log('[maany-sdk] sign: received server payload', { round: i, bytes: inbound.length });
  }

  const format = opts.format ?? 'der';
  const signatureDer = mpc.signFinalize(ctx, signDevice, format);
  mpc.signFree(signDevice);

  await drainTransportQueue(opts.transport, 'device');
  console.log('[maany-sdk] sign: device-only loop complete');

  return format === 'der' ? derToCompactSignature(signatureDer) : signatureDer;
}

async function drainTransportQueue(
  transport: DkgImplOptions['transport'],
  participant: 'device' | 'server'
): Promise<void> {
  while (true) {
    const next = await transport.receive(participant);
    if (!next) {
      break;
    }
  }
}

function maybeCreateBackup(
  ctx: mpc.Ctx,
  deviceKeypair: mpc.Keypair,
  options?: DeviceBackupOptions
): DeviceBackupArtifacts | null {
  if (options?.enabled === false) {
    console.log('[maany-sdk] coordinator: device backup disabled');
    return null;
  }

  const backupOptions: { threshold?: number; shareCount?: number; label?: Uint8Array } = {};
  if (typeof options?.threshold === 'number') {
    backupOptions.threshold = options.threshold;
  }
  if (typeof options?.shareCount === 'number') {
    backupOptions.shareCount = options.shareCount;
  }
  if (options?.label) {
    backupOptions.label = optionalClone(options.label);
  }

  console.log('[maany-sdk] coordinator: creating device backup', {
    threshold: backupOptions.threshold,
    shareCount: backupOptions.shareCount,
    hasLabel: Boolean(backupOptions.label?.length),
  });
  const result = bindingWithBackup.backupCreate(ctx, deviceKeypair, backupOptions);
  return {
    ciphertext: cloneBackupCiphertext(result.ciphertext),
    shares: result.shares.map((share) => cloneBytes(share)),
  };
}

function cloneBackupCiphertext(ciphertext: BackupCiphertext): BackupCiphertext {
  return {
    kind: ciphertext.kind,
    curve: ciphertext.curve,
    scheme: ciphertext.scheme,
    keyId: cloneBytes(ciphertext.keyId),
    threshold: ciphertext.threshold,
    shareCount: ciphertext.shareCount,
    label: cloneBytes(ciphertext.label),
    blob: cloneBytes(ciphertext.blob),
  };
}
