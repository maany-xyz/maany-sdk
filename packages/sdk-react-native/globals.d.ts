declare module '@maanyio/mpc-rn-bare' {
  export type Ctx = object & { readonly __brand: 'ctx' };
  export type Dkg = object & { readonly __brand: 'dkg' };
  export type Keypair = object & { readonly __brand: 'keypair' };
  export type SignSession = object & { readonly __brand: 'sign' };

  export interface DkgOptions {
    role: 'device' | 'server';
    keyId?: Uint8Array;
    sessionId?: Uint8Array;
  }

  export interface StepResult {
    outMsg?: Uint8Array;
    done: boolean;
  }

  export interface SignOptions {
    sessionId?: Uint8Array;
    extraAad?: Uint8Array;
  }

  export type SignatureFormat = 'der' | 'raw-rs';

  export interface Pubkey {
    curve: number;
    compressed: Uint8Array;
  }

  export function init(): Ctx;
  export function shutdown(ctx: Ctx): void;
  export function dkgNew(ctx: Ctx, options: DkgOptions): Dkg;
  export function dkgStep(ctx: Ctx, dkg: Dkg, inPeerMsg?: Uint8Array | null): Promise<StepResult>;
  export function dkgFinalize(ctx: Ctx, dkg: Dkg): Keypair;
  export function dkgFree(dkg: Dkg): void;
  export function kpExport(ctx: Ctx, kp: Keypair): Uint8Array;
  export function kpImport(ctx: Ctx, blob: Uint8Array): Keypair;
  export function kpPubkey(ctx: Ctx, kp: Keypair): Pubkey;
  export function kpFree(kp: Keypair): void;
  export function signNew(ctx: Ctx, kp: Keypair, options?: SignOptions): SignSession;
  export function signSetMessage(ctx: Ctx, sign: SignSession, message: Uint8Array): void;
  export function signStep(ctx: Ctx, sign: SignSession, inPeerMsg?: Uint8Array | null): Promise<StepResult>;
  export function signFinalize(
    ctx: Ctx,
    sign: SignSession,
    format?: SignatureFormat
  ): Uint8Array;
  export function signFree(sign: SignSession): void;
  export function refreshNew(ctx: Ctx, kp: Keypair, options?: { sessionId?: Uint8Array }): Dkg;
}
