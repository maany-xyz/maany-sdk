export interface Coin {
  denom: string;
  amount: string;
}

export interface AnyProto {
  typeUrl: string;
  value: Uint8Array;
}

export interface GasEstimate {
  gasUsed: number;
  gasWanted: number;
  recommended: number;
}

export interface TxResult {
  txhash: string;
  height?: string;
  rawLog?: string;
  code?: number;
  txRawBytes: Uint8Array;
}
