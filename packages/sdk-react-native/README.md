# @maany/sdk-react-native

High-level React Native SDK that wraps the low-level MPC coordinator
(`@maany/mpc-coordinator-rn`). It now exposes two surfaces:

1. `createMaanyWallet` – zero-config helper that dials the coordinator over WebSocket,
   handles tokens/session IDs, picks storage (memory or secure), and runs DKG for you.
2. `createReactNativeWalletAdapter` – lower-level adapter (existing API) for apps that
   want to provide their own transports or coordinator instances.

## Quick Start: `createMaanyWallet`

```ts
import { createMaanyWallet } from '@maany/sdk-react-native';

const wallet = createMaanyWallet({
  serverUrl: 'wss://your-coordinator',
  storage: 'secure', // or 'memory', or pass a ShareStorage implementation
  tokenFactory: async () => fetchTokenFromApi(),
});

const { keyId } = await wallet.createKey();
```

- Uses `EXPO_PUBLIC_MPC_SERVER_URL`/`MAANY_MPC_SERVER_URL` + platform defaults when no URL is provided.
- Falls back to `InMemoryShareStorage` if `SecureShareStorage` is unavailable (e.g., simulator).
- Session IDs default to random 16-byte hex strings; override with `sessionIdFactory`.

## Lower-Level Adapter

The adapter is still available when you need full control.

### What It Does

- Boots a coordinator + MPC context for you (or accepts an existing one).
- Runs DKG as soon as `connect()` is invoked (e.g., after you obtain a JWT).
- Persists the device/server share pair via the coordinator storage so the
  wallet can be restored on app relaunch.
- Emits wallet status/address events the UI layer can subscribe to.
- Provides `sign()` for arbitrary bytes and `signCosmosDoc()` for transactions.

### Usage

```ts
import { createReactNativeWalletAdapter } from '@maany/sdk-react-native';
import {
  SecureShareStorage,
  WebSocketTransport,
} from '@maany/mpc-coordinator-rn';

const transport = await WebSocketTransport.connect({
  url: 'wss://your-coordinator',
  participant: 'device',
});

const adapter = createReactNativeWalletAdapter({
  transport,
  storage: new SecureShareStorage({ promptMessage: 'Authenticate to unlock' }),
});

await adapter.init();            // restore previous share if available
await adapter.connect({ authToken: jwt }); // triggers DKG once token is ready

const statusOff = adapter.onStatus((status) => console.log(status));
const address = await adapter.getAddress();

const { signature } = await adapter.sign({ bytes: messageBytes });
const cosmos = await adapter.signCosmosDoc({ doc: signDoc });

statusOff();
```

## Configuration

Pass a custom `deriveAddress` function if you need a different chain/prefix, or
provide your own `sessionIdFactory` if the default random 32 bytes do not meet
backend expectations. For advanced scenarios you can also create the
coordinator yourself and pass it via `coordinator`.

## Next Steps

- Add refresh / re-share helpers once the MPC core exposes them.
- Expand chain-specific helpers (Ethereum, Solana, etc.).
- Tighten error handling/retry logic around transports and secure storage.
```
