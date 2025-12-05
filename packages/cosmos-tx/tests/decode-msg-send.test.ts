import { describe, expect, it } from 'vitest';
import { decodeMsgSend, buildMsgSend } from '../src';

describe('decodeMsgSend', () => {
  it('decodes protobuf payloads', () => {
    const msg = buildMsgSend({
      fromAddress: 'maany1sender',
      toAddress: 'maany1receiver',
      amount: [
      { denom: 'uatom', amount: '1234' },
      ],
    });

    const decoded = decodeMsgSend(msg.value);
    expect(decoded.fromAddress).toBe('maany1sender');
    expect(decoded.toAddress).toBe('maany1receiver');
    expect(decoded.amount).toEqual([{ denom: 'uatom', amount: '1234' }]);
  });
});
