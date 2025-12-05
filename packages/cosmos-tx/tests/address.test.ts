import { describe, expect, it } from 'vitest';
import { pubkeyToAddress } from '../src';
import { COMPRESSED_PUBKEY, EXPECTED_ADDRESS } from './fixtures/keys';

describe('address derivation', () => {
  it('derives bech32 address from compressed pubkey', () => {
    const address = pubkeyToAddress(COMPRESSED_PUBKEY, 'maany');
    expect(address).toBe(EXPECTED_ADDRESS);
  });
});
