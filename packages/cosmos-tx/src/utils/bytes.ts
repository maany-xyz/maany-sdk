const hasBuffer = typeof Buffer !== 'undefined';

export const toBase64 = (bytes: Uint8Array): string => {
  if (hasBuffer) {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
};

export const fromBase64 = (value: string): Uint8Array => {
  if (hasBuffer) {
    return new Uint8Array(Buffer.from(value, 'base64'));
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

export const utf8ToBytes = (value: string): Uint8Array => {
  if (hasBuffer) {
    return new Uint8Array(Buffer.from(value, 'utf8'));
  }
  const encoder = new TextEncoder();
  return encoder.encode(value);
};

export const bytesToUtf8 = (bytes: Uint8Array): string => {
  if (hasBuffer) {
    return Buffer.from(bytes).toString('utf8');
  }
  const decoder = new TextDecoder();
  return decoder.decode(bytes);
};

export const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  parts.forEach((p) => {
    out.set(p, offset);
    offset += p.length;
  });
  return out;
};
