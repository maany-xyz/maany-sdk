# @maany/cosmos-sign-doc

Lightweight helpers for building and hashing Cosmos SDK ADR-020 SignDoc payloads. The package mirrors the
`.samples/maany-mpc-sdk` implementation so other Maany SDKs can share exactly the same canonical serialization logic.

## Install

```bash
pnpm add @maany/cosmos-sign-doc
```

## Usage

```ts
import { buildSignDoc, hashSignDoc } from '@maany/cosmos-sign-doc';

const signDocBytes = buildSignDoc({
  bodyBytes,
  authInfoBytes,
  chainId: 'cosmoshub-4',
  accountNumber: '42',
});
const digest = hashSignDoc(signDocBytes);
```

The helpers expect already-encoded `bodyBytes` and `authInfoBytes` values (e.g. from `TxBody`/`AuthInfo` encoders). The
resulting digest matches the ADR-020 fixture `1389e7…b22c` from the sample project.

## Scripts

- `pnpm build` – compile TypeScript sources to `dist/`
- `pnpm test` – run the Vitest fixture to confirm the output matches the `.samples` implementation
