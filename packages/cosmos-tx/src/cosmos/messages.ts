import { Reader, Writer } from 'protobufjs/minimal';
import { AnyProto, Coin } from '../types';

export interface MsgSendDecoded {
  fromAddress: string;
  toAddress: string;
  amount: Coin[];
}

export interface MsgSendParams {
  fromAddress: string;
  toAddress: string;
  amount: Coin[];
}

const encodeCoin = (coin: Coin, writer: Writer = Writer.create()): Uint8Array => {
  writer.uint32((1 << 3) | 2).string(coin.denom);
  writer.uint32((2 << 3) | 2).string(coin.amount);
  return writer.finish();
};

export const buildMsgSend = (params: MsgSendParams): AnyProto => {
  const writer = Writer.create();
  writer.uint32((1 << 3) | 2).string(params.fromAddress);
  writer.uint32((2 << 3) | 2).string(params.toAddress);
  params.amount.forEach((coin) => {
    writer.uint32((3 << 3) | 2).bytes(encodeCoin(coin));
  });
  return {
    typeUrl: '/cosmos.bank.v1beta1.MsgSend',
    value: writer.finish(),
  };
};

const decodeCoin = (reader: Reader): Coin => {
  const length = reader.uint32();
  const end = reader.pos + length;
  let denom = '';
  let amount = '';
  while (reader.pos < end) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    switch (field) {
      case 1:
        denom = reader.string();
        break;
      case 2:
        amount = reader.string();
        break;
      default:
        reader.skipType(tag & 7);
    }
  }
  return { denom, amount };
};

export const decodeMsgSend = (bytes: Uint8Array): MsgSendDecoded => {
  const reader = new Reader(bytes);
  let fromAddress = '';
  let toAddress = '';
  const amount: Coin[] = [];

  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    switch (field) {
      case 1:
        fromAddress = reader.string();
        break;
      case 2:
        toAddress = reader.string();
        break;
      case 3:
        amount.push(decodeCoin(reader));
        break;
      default:
        reader.skipType(tag & 7);
    }
  }

  return { fromAddress, toAddress, amount };
};
