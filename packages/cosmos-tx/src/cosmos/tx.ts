import { Writer } from 'protobufjs/minimal';
import { AnyProto, Coin } from '../types';

const SIGN_MODE_DIRECT = 1;

export interface TxBodyParams {
  messages: AnyProto[];
  memo?: string;
  timeoutHeight?: string;
}

export interface AuthInfoParams {
  sequence: string;
  publicKey?: AnyProto;
  gasLimit: string;
  feeAmount: Coin[];
  payer?: string;
  granter?: string;
}

export interface TxRawParams {
  bodyBytes: Uint8Array;
  authInfoBytes: Uint8Array;
  signatures: Uint8Array[];
}

const encodeAny = (any: AnyProto, writer: Writer = Writer.create()): Uint8Array => {
  writer.uint32((1 << 3) | 2).string(any.typeUrl);
  writer.uint32((2 << 3) | 2).bytes(any.value);
  return writer.finish();
};

const encodeCoin = (coin: Coin, writer: Writer = Writer.create()): Uint8Array => {
  writer.uint32((1 << 3) | 2).string(coin.denom);
  writer.uint32((2 << 3) | 2).string(coin.amount);
  return writer.finish();
};

export const buildTxBody = (params: TxBodyParams): Uint8Array => {
  const writer = Writer.create();
  params.messages.forEach((msg) => {
    writer.uint32((1 << 3) | 2).bytes(encodeAny(msg));
  });
  if (params.memo) {
    writer.uint32((2 << 3) | 2).string(params.memo);
  }
  if (params.timeoutHeight) {
    writer.uint32((3 << 3) | 0).uint64(params.timeoutHeight);
  }
  return writer.finish();
};

const buildModeInfoSingle = (writer: Writer = Writer.create()): Uint8Array => {
  const singleWriter = Writer.create();
  singleWriter.uint32((1 << 3) | 0).int32(SIGN_MODE_DIRECT);
  writer.uint32((1 << 3) | 2).bytes(singleWriter.finish());
  return writer.finish();
};

const buildSignerInfo = (params: { publicKey?: AnyProto; sequence: string }) => {
  const writer = Writer.create();
  if (params.publicKey) {
    writer.uint32((1 << 3) | 2).bytes(encodeAny(params.publicKey));
  }
  writer.uint32((2 << 3) | 2).bytes(buildModeInfoSingle());
  writer.uint32((3 << 3) | 0).uint64(params.sequence);
  return writer.finish();
};

const buildFee = (params: { amount: Coin[]; gasLimit: string; payer?: string; granter?: string }) => {
  const writer = Writer.create();
  params.amount.forEach((coin) => {
    writer.uint32((1 << 3) | 2).bytes(encodeCoin(coin));
  });
  writer.uint32((2 << 3) | 0).uint64(params.gasLimit);
  if (params.payer) {
    writer.uint32((3 << 3) | 2).string(params.payer);
  }
  if (params.granter) {
    writer.uint32((4 << 3) | 2).string(params.granter);
  }
  return writer.finish();
};

export const buildAuthInfo = (params: AuthInfoParams): Uint8Array => {
  const writer = Writer.create();
  writer.uint32((1 << 3) | 2).bytes(
    buildSignerInfo({ publicKey: params.publicKey, sequence: params.sequence }),
  );
  writer.uint32((2 << 3) | 2).bytes(
    buildFee({
      amount: params.feeAmount,
      gasLimit: params.gasLimit,
      payer: params.payer,
      granter: params.granter,
    }),
  );
  return writer.finish();
};

export const buildTxRaw = (params: TxRawParams): Uint8Array => {
  const writer = Writer.create();
  writer.uint32((1 << 3) | 2).bytes(params.bodyBytes);
  writer.uint32((2 << 3) | 2).bytes(params.authInfoBytes);
  params.signatures.forEach((sig) => {
    writer.uint32((3 << 3) | 2).bytes(sig);
  });
  return writer.finish();
};
