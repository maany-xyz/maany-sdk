import { Writer } from 'protobufjs/minimal';
import { sha256 } from '@noble/hashes/sha256';

export interface SignDocParams {
  bodyBytes: Uint8Array;
  authInfoBytes: Uint8Array;
  chainId: string;
  accountNumber: string;
}

export function buildSignDoc(params: SignDocParams): Uint8Array {
  const writer = Writer.create();
  writer.uint32((1 << 3) | 2).bytes(params.bodyBytes);
  writer.uint32((2 << 3) | 2).bytes(params.authInfoBytes);
  writer.uint32((3 << 3) | 2).string(params.chainId);
  writer.uint32((4 << 3) | 0).uint64(params.accountNumber);
  return writer.finish();
}

export function hashSignDoc(signDocBytes: Uint8Array): Uint8Array {
  return Uint8Array.from(sha256(signDocBytes));
}
