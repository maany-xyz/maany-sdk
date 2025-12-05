import { ripemd160Hash, sha256Hash } from './hash';
import { toBech32 } from './bech32';

export const pubkeyToAddress = (pubkey33: Uint8Array, prefix: string): string => {
  const sha = sha256Hash(pubkey33);
  const ripe = ripemd160Hash(sha);
  return toBech32(prefix, ripe);
};
