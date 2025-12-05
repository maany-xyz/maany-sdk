import { bech32 } from '@scure/base';

export const toBech32 = (prefix: string, data: Uint8Array): string => {
  const words = bech32.toWords(data);
  return bech32.encode(prefix, words);
};
