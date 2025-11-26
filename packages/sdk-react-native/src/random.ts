export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  if (length === 0) {
    return out;
  }
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(out);
    return out;
  }
  for (let i = 0; i < length; i += 1) {
    out[i] = Math.floor(Math.random() * 256);
  }
  return out;
}
