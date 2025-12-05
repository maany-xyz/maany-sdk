import { JsonTransport } from '../core/transport';
import { GasEstimate, TxResult } from '../types';
import { toBase64 } from '../utils/bytes';

interface AccountResponse {
  account?: {
    account_number?: string;
    sequence?: string;
    pub_key?: unknown;
  };
}

interface SimulateResponse {
  gas_info?: {
    gas_used?: string;
    gas_wanted?: string;
  };
}

interface BroadcastResponse {
  tx_response?: {
    txhash: string;
    height?: string;
    raw_log?: string;
    code?: number;
  };
}

export const fetchBaseAccount = async (
  transport: JsonTransport,
  address: string,
): Promise<{ accountNumber: string; sequence: string; pubKeyPresent: boolean }> => {
  const response = await transport.get<AccountResponse>(`/cosmos/auth/v1beta1/accounts/${address}`);
  const account = response.account ?? {};
  return {
    accountNumber: account.account_number ?? '0',
    sequence: account.sequence ?? '0',
    pubKeyPresent: Boolean(account.pub_key),
  };
};

export const simulateTx = async (
  transport: JsonTransport,
  txBytes: Uint8Array,
): Promise<GasEstimate> => {
  const response = await transport.post<SimulateResponse>(`/cosmos/tx/v1beta1/simulate`, {
    tx_bytes: toBase64(txBytes),
  });
  const gasUsed = Number(response.gas_info?.gas_used ?? '0');
  const gasWanted = Number(response.gas_info?.gas_wanted ?? gasUsed);
  return {
    gasUsed,
    gasWanted,
    recommended: gasWanted,
  };
};

export const broadcastTx = async (
  transport: JsonTransport,
  txBytes: Uint8Array,
  mode: 'BROADCAST_MODE_SYNC' | 'BROADCAST_MODE_ASYNC' | 'BROADCAST_MODE_BLOCK',
): Promise<TxResult> => {
  const response = await transport.post<BroadcastResponse>(`/cosmos/tx/v1beta1/txs`, {
    tx_bytes: toBase64(txBytes),
    mode,
  });
  const tx = response.tx_response;
  return {
    txhash: tx?.txhash ?? '',
    height: tx?.height,
    rawLog: tx?.raw_log,
    code: tx?.code,
    txRawBytes: txBytes,
  };
};
