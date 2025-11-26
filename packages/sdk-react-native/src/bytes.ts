import { bytesToHex, bytesToUtf8, utf8ToBytes } from '@noble/hashes/utils';

export const hexFromBytes = (bytes: Uint8Array): string => bytesToHex(bytes);
export const bytesFromUtf8 = (value: string): Uint8Array => utf8ToBytes(value);
export const utf8FromBytes = (bytes: Uint8Array): string => bytesToUtf8(bytes);
export const cloneBytes = (source: Uint8Array): Uint8Array => new Uint8Array(source);

export const bytesFromHex = (hex: string): Uint8Array => {
  const normalized = hex.trim().toLowerCase().replace(/^0x/, '');
  if (normalized.length === 0) {
    return new Uint8Array(0);
  }
  if (normalized.length % 2 !== 0) {
    throw new Error('Hex string must have an even length');
  }
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    const pair = normalized.slice(i * 2, i * 2 + 2);
    const value = Number.parseInt(pair, 16);
    if (Number.isNaN(value)) {
      throw new Error(`Invalid hex characters: ${pair}`);
    }
    bytes[i] = value;
  }
  return bytes;
};
