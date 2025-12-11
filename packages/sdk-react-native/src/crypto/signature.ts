import { concatBytes } from '../bytes';
import { Buffer } from 'buffer';

const SECP256K1_N = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');
const HALF_N = SECP256K1_N >> 1n;

export function derToCompactSignature(der: Uint8Array): Uint8Array {
  if (der.length < 8 || der[0] !== 0x30) {
    throw new Error('Invalid DER signature');
  }
  const { r, s } = decodeDer(der);
  const rBytes = pad32(r);
  const normalizedS = s > HALF_N ? SECP256K1_N - s : s;
  const sBytes = pad32(normalizedS);
  return concatBytes(rBytes, sBytes);
}

function decodeDer(der: Uint8Array): { r: bigint; s: bigint } {
  let offset = 2;
  if (der[1] & 0x80) {
    const lengthBytes = der[1] & 0x7f;
    offset = 2 + lengthBytes;
  }
  if (der[offset] !== 0x02) {
    throw new Error('Invalid DER signature (missing R tag)');
  }
  const rLen = der[offset + 1];
  const rStart = offset + 2;
  offset = rStart + rLen;
  if (der[offset] !== 0x02) {
    throw new Error('Invalid DER signature (missing S tag)');
  }
  const sLen = der[offset + 1];
  const sStart = offset + 2;
  const r = bytesToBigInt(der.slice(rStart, rStart + rLen));
  const s = bytesToBigInt(der.slice(sStart, sStart + sLen));
  return { r, s };
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let hex = Buffer.from(bytes).toString('hex');
  if (hex.length === 0) {
    return 0n;
  }
  while (hex.startsWith('00')) {
    hex = hex.slice(2);
  }
  return BigInt('0x' + (hex || '0'));
}

function pad32(value: bigint): Uint8Array {
  const hex = value.toString(16).padStart(64, '0');
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}
