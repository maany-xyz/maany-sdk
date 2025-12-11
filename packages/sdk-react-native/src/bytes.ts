import { bytesToHex, bytesToUtf8, utf8ToBytes } from '@noble/hashes/utils';

export const hexFromBytes = (bytes: Uint8Array): string => bytesToHex(bytes);
export const bytesFromUtf8 = (value: string): Uint8Array => utf8ToBytes(value);
export const utf8FromBytes = (bytes: Uint8Array): string => bytesToUtf8(bytes);
export const cloneBytes = (source: Uint8Array): Uint8Array => new Uint8Array(source);
export const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

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


export function bytesFromBase64(value: string): Uint8Array {
  const sanitized = value.replace(/[^A-Za-z0-9+/=]/g, '');
  if (sanitized.length % 4 !== 0) {
    throw new Error('Invalid base64 input length');
  }
  const outputLength = (sanitized.length / 4) * 3 - (sanitized.endsWith('==') ? 2 : sanitized.endsWith('=') ? 1 : 0);
  const bytes = new Uint8Array(outputLength);
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const char of sanitized) {
    if (char === '=') {
      break;
    }
    const valueIndex = BASE64_ALPHABET.indexOf(char);
    if (valueIndex === -1) {
      continue;
    }
    buffer = (buffer << 6) | (valueIndex & 0x3f);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      const byte = (buffer >> bits) & 0xff;
      if (index < bytes.length) {
        bytes[index++] = byte;
      }
    }
  }
  return bytes;
}

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
