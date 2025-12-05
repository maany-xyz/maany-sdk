const hexToBytes = (hex: string): Uint8Array => {
  const clean = hex.replace(/^0x/, '');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.slice(i, i + 2), 16);
  }
  return bytes;
};

export const COMPRESSED_PUBKEY_HEX =
  '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';

export const COMPRESSED_PUBKEY = hexToBytes(COMPRESSED_PUBKEY_HEX);
export const EXPECTED_ADDRESS = 'maany1w508d6qejxtdg4y5r3zarvary0c5xw7klu7nmg';
