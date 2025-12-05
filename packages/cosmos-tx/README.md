# @maany/cosmos-tx

Cosmos SDK transaction helpers extracted from `.samples/maany-mpc-sdk`. The package provides TxBody/AuthInfo encoders,
bech32 utilities, basic REST wrappers, and protobuf helpers used by Maany wallets.

## Install

```bash
pnpm add @maany/cosmos-tx
```

## Highlights

- `buildTxBody`, `buildAuthInfo`, `buildTxRaw` – encode core Cosmos transaction messages.
- `pubkeyToAddress`, `buildSecp256k1PubkeyAny` – derive addresses and `/cosmos.crypto.secp256k1.PubKey` protos.
- `fetchBaseAccount`, `simulateTx`, `broadcastTx` – minimal REST helpers using `JsonTransport`.
- Utility exports for bech32, base64, and SHA-256 / RIPEMD-160 hashing.

Each helper is a straight port from the working `.samples` implementation so we can centralize Cosmos logic that other
packages consume.
