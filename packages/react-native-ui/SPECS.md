0) Target structure
maany-sdk/
  packages/
    react-native-ui/
      src/
        context/MaanyProvider.tsx
        adapters/                 # phase-1 stub + phase-2 real adapters
          FakeWalletAdapter.ts
          CoordinatorWalletAdapter.ts   # added in phase-2
          types.ts
        hooks/
          useMaany.ts
          useWallet.ts
          useConnection.ts
        components/
          WalletButton.tsx
          ConnectModal.tsx
          ApprovalSheet.tsx
          AddressBadge.tsx
          TxReviewCard.tsx
        theming/
          ThemeProvider.tsx
          tokens.ts
        utils/
          format.ts
        index.ts
      package.json
      tsconfig.build.json
      README.md
  examples/
    rn-wallet-app/               # uses @maany/react-native-ui (Phase 1 & 2)
    headless-rn/                 # (optional) direct coordinator tests in Phase 2

1) The Adapter Contract (keeps UI decoupled)

Create a very small interface the UI depends on—works with a fake implementation first, then a real one later.

// packages/react-native-ui/src/adapters/types.ts
export type WalletStatus = 'idle' | 'connecting' | 'ready' | 'error' | 'locked';

export interface ConnectOptions {
  prompt?: string; // optional UI hint
}

export interface SignInput {
  doc: Uint8Array;
  // optional chain-specific fields added later
}

export interface SignResult {
  signature: Uint8Array;
}

export interface WalletEvents {
  onStatus(cb: (s: WalletStatus) => void): () => void;
  onAddress(cb: (addr: string | null) => void): () => void;
  onError(cb: (e: unknown) => void): () => void;
}

export interface WalletAdapter extends WalletEvents {
  init(): Promise<void>;                     // restore session if any
  connect(opts?: ConnectOptions): Promise<void>;
  disconnect(): Promise<void>;
  getAddress(): Promise<string | null>;
  sign(input: SignInput): Promise<SignResult>;
}


The UI layer only talks to WalletAdapter. In Phase 1 you give them FakeWalletAdapter. In Phase 2 you replace it with CoordinatorWalletAdapter (which delegates to @maany/mpc-coordinator-rn).

2) Phase 1 — Build UI with a Fake Wallet
2.1 Fake adapter
// packages/react-native-ui/src/adapters/FakeWalletAdapter.ts
import { WalletAdapter, WalletStatus, SignInput, SignResult } from './types';

export class FakeWalletAdapter implements WalletAdapter {
  private status: WalletStatus = 'idle';
  private addr: string | null = null;
  private statusSubs = new Set<(s: WalletStatus) => void>();
  private addrSubs = new Set<(a: string | null) => void>();
  private errSubs = new Set<(e: unknown) => void>();

  private emitStatus(s: WalletStatus) { this.status = s; this.statusSubs.forEach(cb => cb(s)); }
  private emitAddr(a: string | null) { this.addr = a; this.addrSubs.forEach(cb => cb(a)); }

  async init() { /* noop for stub */ }

  async connect() {
    this.emitStatus('connecting');
    await new Promise(r => setTimeout(r, 600));
    this.emitAddr('maany1fakeaddressxyz...');
    this.emitStatus('ready');
  }

  async disconnect() {
    this.emitAddr(null);
    this.emitStatus('idle');
  }

  async getAddress() { return this.addr; }

  async sign(_: SignInput): Promise<SignResult> {
    if (this.status !== 'ready' || !this.addr) throw new Error('Not connected');
    // Return a fake signature
    return { signature: new Uint8Array([0xde, 0xad, 0xbe, 0xef]) };
  }

  onStatus(cb: (s: WalletStatus) => void) { this.statusSubs.add(cb); return () => this.statusSubs.delete(cb); }
  onAddress(cb: (a: string | null) => void) { this.addrSubs.add(cb); return () => this.addrSubs.delete(cb); }
  onError(cb: (e: unknown) => void) { this.errSubs.add(cb); return () => this.errSubs.delete(cb); }
}

2.2 Provider + hooks
// context/MaanyProvider.tsx
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { WalletAdapter, WalletStatus } from '../adapters/types';

const Ctx = createContext<WalletAdapter | null>(null);

export const MaanyProvider: React.FC<{
  adapter: WalletAdapter;   // Phase 1: FakeWalletAdapter; Phase 2: CoordinatorWalletAdapter
  children: React.ReactNode;
}> = ({ adapter, children }) => {
  useEffect(() => { adapter.init().catch(() => void 0); }, [adapter]);
  return <Ctx.Provider value={adapter}>{children}</Ctx.Provider>;
};

export const useMaany = () => {
  const a = useContext(Ctx);
  if (!a) throw new Error('useMaany must be used within MaanyProvider');
  return a;
};

// hooks/useWallet.ts
export function useWallet() {
  const adapter = useMaany();
  const [status, setStatus] = useState<WalletStatus>('idle');
  const [address, setAddress] = useState<string | null>(null);

  useEffect(() => {
    const offS = adapter.onStatus(setStatus);
    const offA = adapter.onAddress(setAddress);
    adapter.getAddress().then(setAddress).catch(() => void 0);
    return () => { offS(); offA(); };
  }, [adapter]);

  return {
    status,
    address,
    connect: (prompt?: string) => adapter.connect({ prompt }),
    disconnect: () => adapter.disconnect(),
    sign: adapter.sign.bind(adapter),
  };
}

2.3 Components (start small)

WalletButton.tsx – connect / show address

ConnectModal.tsx – basic modal triggered by WalletButton if not connected

ApprovalSheet.tsx – confirm signing a payload

AddressBadge.tsx – compact address display

TxReviewCard.tsx – shows doc hash / bytes length

Example:

// components/WalletButton.tsx
import React from 'react';
import { Pressable, Text } from 'react-native';
import { useWallet } from '../hooks/useWallet';

export const WalletButton: React.FC = () => {
  const { status, address, connect, disconnect } = useWallet();
  if (!address) {
    return <Pressable onPress={() => connect('Authenticate to connect')}><Text>
      {status === 'connecting' ? 'Connecting…' : 'Connect Wallet'}
    </Text></Pressable>;
  }
  return <Pressable onPress={disconnect}><Text numberOfLines={1}>🔗 {address}</Text></Pressable>;
};

2.4 Example app wiring (Phase 1)

In examples/rn-wallet-app:

import React from 'react';
import { SafeAreaView } from 'react-native';
import { MaanyProvider } from '@maany/react-native-ui';
import { WalletButton } from '@maany/react-native-ui';
import { FakeWalletAdapter } from '@maany/react-native-ui/adapters/FakeWalletAdapter';

export default function App() {
  return (
    <MaanyProvider adapter={new FakeWalletAdapter()}>
      <SafeAreaView style={{ padding: 24 }}>
        <WalletButton />
      </SafeAreaView>
    </MaanyProvider>
  );
}


Run locally

pnpm i

pnpm --filter @maany/react-native-ui build

cd examples/rn-wallet-app && pnpm i

iOS: cd ios && pod install && cd .. && pnpm ios

Android: pnpm android

Goal: UI works: connect shows a fake address, sign returns a fake signature, UI states transition correctly.

3) Phase 2 — Wire the Real Coordinator
3.1 Real adapter
// adapters/CoordinatorWalletAdapter.ts
import type { WalletAdapter, WalletStatus, SignInput, SignResult } from './types';
import { createCoordinator, WebSocketTransport, SecureShareStorage } from '@maany/mpc-coordinator-rn';

export class CoordinatorWalletAdapter implements WalletAdapter {
  private status: WalletStatus = 'idle';
  private addr: string | null = null;
  private statusSubs = new Set<(s: WalletStatus) => void>();
  private addrSubs = new Set<(a: string | null) => void>();
  private errSubs = new Set<(e: unknown) => void>();
  private coord = createCoordinator({
    transport: new WebSocketTransport({ url: 'wss://coord.maany.xyz' }),
    storage: new SecureShareStorage({ promptMessage: 'Authenticate to unlock your wallet' }),
  });
  private ctx = this.coord.initContext();

  private emitStatus(s: WalletStatus) { this.status = s; this.statusSubs.forEach(cb => cb(s)); }
  private emitAddr(a: string | null) { this.addr = a; this.addrSubs.forEach(cb => cb(a)); }
  private emitErr(e: unknown) { this.errSubs.forEach(cb => cb(e)); }

  async init() {
    // Try restoring address if persisted (depends on your coordinator restore API)
    // Optionally set status to 'locked' if a share exists but not unlocked
  }

  async connect() {
    try {
      this.emitStatus('connecting');
      const { deviceKeypair } = await this.coord.runDkg(this.ctx, { sessionId: crypto.getRandomValues(new Uint8Array(16)) });
      const addr = await this.coord.pubkeyToCosmosAddress(deviceKeypair.pubkey);
      this.emitAddr(addr);
      this.emitStatus('ready');
    } catch (e) {
      this.emitStatus('error'); this.emitErr(e);
      throw e;
    }
  }

  async disconnect() {
    // Clear local share and session if desired
    await this.coord.clear?.(this.ctx);
    this.emitAddr(null); this.emitStatus('idle');
  }

  async getAddress() { return this.addr; }

  async sign({ doc }: SignInput): Promise<SignResult> {
    try {
      const sig = await this.coord.runSign(this.ctx, /* deviceKeypair */ undefined as any, /* serverKeypair */ undefined as any, {
        message: doc,
        transport: this.coord.options.transport
      });
      return { signature: sig };
    } catch (e) {
      this.emitErr(e); throw e;
    }
  }

  onStatus(cb: (s: WalletStatus) => void) { this.statusSubs.add(cb); return () => this.statusSubs.delete(cb); }
  onAddress(cb: (a: string | null) => void) { this.addrSubs.add(cb); return () => this.addrSubs.delete(cb); }
  onError(cb: (e: unknown) => void) { this.errSubs.add(cb); return () => this.errSubs.delete(cb); }
}


Replace the runDkg/runSign call shapes to match your actual coordinator API. The adapter translates UI-friendly calls into coordinator calls.

3.2 Switch the example app to real adapter (feature flag)
// examples/rn-wallet-app/App.tsx
const useFake = false; // toggle
const adapter = useFake ? new FakeWalletAdapter() : new CoordinatorWalletAdapter();

<MaanyProvider adapter={adapter}>
  {/* same UI */}
</MaanyProvider>

3.3 Testing in a controlled env

Point the adapter to your staging coordinator URL.

Use a test backend that accepts test sessions and a fixed allowlist.

Add a “Reset Wallet” dev-only action that clears secure storage and local session.

4) Testing & Quality

Unit tests (Phase 1 & 2)

Use React Native Testing Library:

WalletButton shows “Connect Wallet” when not connected

After connect(), shows address

TxReviewCard renders hash/bytes count

Mock the adapter via context.

Contract tests (Phase 2)

Provide a tiny contract suite that mounts the UI with CoordinatorWalletAdapter against a mock coordinator (or staging) to cover:

DKG success/cancel

Sign success/deny

Transport drop/reconnect → UI reflects state

Manual scenarios

Airplane mode toggle during connect/sign

Biometric cancel vs. lockout

Coordinator 401 → UI shows “re-auth required”

A11y & i18n

Add accessibilityLabel to buttons and modals.

Centralize strings for later localization.

5) Dev workflow for the engineer

Phase 1

Implement FakeWalletAdapter, Provider, hooks, and 3–5 components.

Run the example app; validate UX (connect, fake sign).

Write basic unit tests.

Prepare for Phase 2

Keep all UI logic behind WalletAdapter.

No coordinator imports in UI files (only in the real adapter).

Phase 2

Implement CoordinatorWalletAdapter.

Add feature flag to the example app to switch adapters.

Run against staging coordinator; iterate on error states.

Docs

In react-native-ui/README.md: document both modes

“Quick Start (Stubbed)”

“Switch to Real Coordinator”

“Troubleshooting (iOS Keychain / Android Keystore)”

6) Acceptance criteria

Phase 1

Example app compiles & runs on iOS/Android.

WalletButton toggles from Connect → Address shown.

ApprovalSheet can “sign” and returns a fake signature.

Unit tests pass in CI.

Phase 2

Same UI, no prop changes, now talks to real coordinator.

Can complete DKG + sign with test backend.

Error states (cancel/timeout/reconnect) surface correctly.

CI builds + basic E2E (Detox optional) pass.