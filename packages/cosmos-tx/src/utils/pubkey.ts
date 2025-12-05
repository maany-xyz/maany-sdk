import { Writer } from 'protobufjs/minimal';
import { AnyProto } from '../types';

export const buildSecp256k1PubkeyAny = (compressedPubkey33: Uint8Array): AnyProto => ({
  typeUrl: '/cosmos.crypto.secp256k1.PubKey',
  value: Writer.create().uint32((1 << 3) | 2).bytes(compressedPubkey33).finish(),
});
