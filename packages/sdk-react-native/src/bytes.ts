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

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

export function bytesToBase64(bytes: Uint8Array): string {
  let output = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const a = bytes[i];
    const b = i + 1 < len ? bytes[i + 1] : 0;
    const c = i + 2 < len ? bytes[i + 2] : 0;
    const triplet = (a << 16) | (b << 8) | c;
    output += BASE64_ALPHABET[(triplet >> 18) & 0x3f];
    output += BASE64_ALPHABET[(triplet >> 12) & 0x3f];
    output += i + 1 < len ? BASE64_ALPHABET[(triplet >> 6) & 0x3f] : '=';
    output += i + 2 < len ? BASE64_ALPHABET[triplet & 0x3f] : '=';
  }
  return output;
}
