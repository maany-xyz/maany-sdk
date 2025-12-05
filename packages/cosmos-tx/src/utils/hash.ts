import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';

export const sha256Hash = (data: Uint8Array | string): Uint8Array => {
  const input = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return Uint8Array.from(sha256(input));
};

export const ripemd160Hash = (data: Uint8Array): Uint8Array => Uint8Array.from(ripemd160(data));
