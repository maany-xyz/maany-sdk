import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import {
  createMaanyWallet,
  resolveApiBaseUrl,
  walletExistsRemotely,
} from '@maany/sdk-react-native';
import type { SignResult, WalletStatus } from '@maany/sdk-react-native';
import { pubkeyToCosmosAddress, InMemoryShareStorage } from '@maanyio/mpc-coordinator-rn';
import * as mpc from '@maanyio/mpc-rn-bare';
import ParallaxScrollView from '@/components/parallax-scroll-view';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

const DEFAULT_SERVER_URL = Platform.OS === 'android' ? 'ws://10.0.2.2:8080' : 'ws://localhost:8080';
const METADATA_KEY = 'maany:wallet:key-id';
const mpcExtended = mpc as typeof mpc & {
  kpImport?: (ctx: mpc.Ctx, blob: Uint8Array) => mpc.Keypair;
  kpPubkey?: (ctx: mpc.Ctx, kp: mpc.Keypair) => { curve: number; compressed: Uint8Array };
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.trim().replace(/^0x/, '');
  if (!normalized) {
    return new Uint8Array(0);
  }
  if (normalized.length % 2 !== 0) {
    throw new Error('Session id must have an even number of characters');
  }
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function utf8FromBytes(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

function stringToBytes(value: string): Uint8Array {
  return encoder.encode(value);
}

function getPubkeyBytes(ctx: mpc.Ctx, keypair: mpc.Keypair): Uint8Array | null {
  if (typeof mpcExtended.kpPubkey === 'function') {
    const result = mpcExtended.kpPubkey(ctx, keypair);
    if (result && result.compressed instanceof Uint8Array) {
      return new Uint8Array(result.compressed);
    }
  }
  return null;
}

export default function WalletScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [token, setToken] = useState('');
  const [status, setStatus] = useState<WalletStatus>('idle');
  const [address, setAddress] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [keyId, setKeyId] = useState<string | null>(null);
  const [message, setMessage] = useState('Hello from Expo 👋');
  const [signature, setSignature] = useState<SignResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [signing, setSigning] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [remoteWalletStatus, setRemoteWalletStatus] = useState<'unknown' | 'checking' | 'absent' | 'exists' | 'error'>(
    'unknown'
  );
  const [localShareHex, setLocalShareHex] = useState<string | null>(null);
  const [publicKeyHex, setPublicKeyHex] = useState<string | null>(null);
  const [pubkeyError, setPubkeyError] = useState<string | null>(null);

  const storageRef = useRef(new InMemoryShareStorage());
  const walletRef = useRef<ReturnType<typeof createMaanyWallet> | null>(null);

  const cleanupConnection = useCallback(() => {
    walletRef.current = null;
  }, []);
  const refreshKeyId = useCallback(async () => {
    try {
      const record = await storageRef.current.load(METADATA_KEY);
      const value = record ? utf8FromBytes(record.blob) : null;
      setKeyId(value);
      return value;
    } catch (storageError) {
      console.warn('Failed to read persisted key id', storageError);
      return null;
    }
  }, []);

  useEffect(() => {
    return () => {
      cleanupConnection();
    };
  }, [cleanupConnection]);

  const createWalletInstance = useCallback(() => {
    return createMaanyWallet({
      serverUrl: serverUrl.trim(),
      storage: storageRef.current,
      backup: {
        shareCount: 3,
        threshold: 2,
      },
      backupUploadUrl: 'http://localhost:8090',
      backupUploadToken: token.trim() || undefined,
    });
  }, [serverUrl, token]);

  const handleConnect = useCallback(async () => {
    if (!serverUrl.trim()) {
      setError('Provide a coordinator URL before connecting.');
      return;
    }
    setConnecting(true);
    setError(null);
    setSignature(null);
    try {
      cleanupConnection();
      const keyIdHex = '6d61616e792d77616c6c65742d6b65792d303030303030303030303030303031';
      const apiUrl = resolveApiBaseUrl(undefined, serverUrl.trim());
      if (apiUrl) {
        setRemoteWalletStatus('checking');
        try {
          const exists = await walletExistsRemotely({
            baseUrl: apiUrl,
            walletId: keyIdHex,
            token: token.trim() || undefined,
          });
          setRemoteWalletStatus(exists ? 'exists' : 'absent');
          if (exists) {
            setError('Remote wallet already exists. Start recovery.');
            setConnecting(false);
            return;
          }
        } catch (lookupError) {
          console.warn('Wallet lookup failed', lookupError);
          setRemoteWalletStatus('error');
        }
      }
      const wallet = createWalletInstance();
      walletRef.current = wallet;
      const result = await wallet.createKey({
        keyId: hexToBytes(keyIdHex),
        token: token.trim() || undefined,
      });
      setSessionId(result.sessionId);
      setKeyId(result.keyId);
      await refreshKeyId();
      setStatus('ready');
      setError(null);
    } catch (connectionError) {
      cleanupConnection();
      setStatus('error');
      setError(connectionError instanceof Error ? connectionError.message : String(connectionError));
    } finally {
      setConnecting(false);
    }
  }, [cleanupConnection, createWalletInstance, refreshKeyId, serverUrl, token]);

  const handleDisconnect = useCallback(async () => {
    setConnecting(true);
    try {
      storageRef.current = new InMemoryShareStorage();
      setAddress(null);
      setSessionId(null);
      setKeyId(null);
      setSignature(null);
      setStatus('idle');
      setRemoteWalletStatus('unknown');
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : String(disconnectError));
    } finally {
      cleanupConnection();
      setConnecting(false);
    }
  }, [cleanupConnection]);

  const handleRecover = useCallback(async () => {
    const keyIdHex = '6d61616e792d77616c6c65742d6b65792d303030303030303030303030303031';
    setRecovering(true);
    setError(null);
    try {
      const wallet = createWalletInstance();
      walletRef.current = wallet;
      const result = await wallet.recoverKey({
        keyId: hexToBytes(keyIdHex),
        token: token.trim() || undefined,
      });
      setKeyId(result.keyId);
      setStatus('ready');
      setRemoteWalletStatus('absent');
      await refreshKeyId();
    } catch (recoverError) {
      setError(recoverError instanceof Error ? recoverError.message : String(recoverError));
    } finally {
      setRecovering(false);
    }
  }, [createWalletInstance, refreshKeyId, token]);

  const handleSign = useCallback(async () => {
    setError('Signing not implemented in createMaanyWallet demo.');
  }, []);

  const handleShowKeyData = useCallback(async () => {
    setPubkeyError(null);
    let currentKeyId = keyId;
    if (!currentKeyId) {
      try {
        const meta = await storageRef.current.load(METADATA_KEY);
        currentKeyId = meta ? utf8FromBytes(meta.blob) : null;
        if (currentKeyId) {
          setKeyId(currentKeyId);
        }
        console.log('[maany-sdk-demo] show key: loaded metadata key', currentKeyId);
      } catch (metaError) {
        console.warn('Failed to load metadata key', metaError);
      }
    }
    if (!currentKeyId) {
      setError('No key ID available. Run DKG or recovery first.');
      return;
    }
    try {
      console.log('[maany-sdk-demo] show key: loading share for', currentKeyId);
      const record = await storageRef.current.load(currentKeyId);
      if (!record) {
        setError('Local key share not found.');
        return;
      }
      console.log('[maany-sdk-demo] show key: loaded share bytes', record.blob.length);
      const shareHex = bytesToHex(record.blob);
      setLocalShareHex(shareHex);
      if (typeof mpcExtended.kpImport !== 'function') {
        console.log('[maany-sdk-demo] show key: kpImport unavailable');
        setPubkeyError('mpc.kpImport unavailable on this platform.');
        return;
      }
      const ctx = mpc.init();
      try {
        const keypair = mpcExtended.kpImport(ctx, record.blob);
        const pub = getPubkeyBytes(ctx, keypair);
        if (pub) {
          const pubHex = bytesToHex(pub);
          setPublicKeyHex(pubHex);
          try {
            const address = pubkeyToCosmosAddress(pub);
            setAddress(address);
            console.log('[maany-sdk-demo] show key: derived address', address);
          } catch (addrError) {
            console.warn('[maany-sdk-demo] show key: failed to derive address', addrError);
          }
          console.log('[maany-sdk-demo] show key: derived public key', pubHex);
        } else {
          console.log('[maany-sdk-demo] show key: kpPubkey unavailable');
          setPubkeyError('Unable to derive public key.');
        }
        mpc.kpFree(keypair);
      } finally {
        mpc.shutdown(ctx);
      }
    } catch (shareError) {
      setError(shareError instanceof Error ? shareError.message : String(shareError));
      console.warn('[maany-sdk-demo] show key: failed to load share', shareError);
    }
  }, [keyId]);

  const statusColor = status === 'ready' ? Colors[colorScheme].tint : Colors[colorScheme].text;
  const remoteWalletLabel = (() => {
    switch (remoteWalletStatus) {
      case 'checking':
        return 'checking…';
      case 'exists':
        return 'exists (start recovery)';
      case 'absent':
        return 'not found';
      case 'error':
        return 'lookup failed';
      default:
        return 'unknown';
    }
  })();

  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: '#E0F2FE', dark: '#082733' }}
      headerImage={<IconSymbol name="key.fill" size={220} color="#0a7ea4" style={styles.headerIcon} />}>
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedView style={styles.section}>
          <ThemedText type="title">Maany Wallet tester</ThemedText>
          <ThemedText>
            Point the app to your MPC coordinator, run distributed key generation, and try signing test
            payloads without leaving Expo.
          </ThemedText>
        </ThemedView>

        <ThemedView style={styles.card}>
          <ThemedText type="subtitle">Coordinator configuration</ThemedText>
          <TextInput
            style={[styles.input, { borderColor: Colors[colorScheme].tint, color: Colors[colorScheme].text }]}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="wss://coordinator.example.com"
            placeholderTextColor="#9BA1A6"
            value={serverUrl}
            onChangeText={setServerUrl}
          />
          <TextInput
            style={[styles.input, { borderColor: Colors[colorScheme].tint, color: Colors[colorScheme].text }]}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Optional auth token"
            placeholderTextColor="#9BA1A6"
            value={token}
            onChangeText={setToken}
          />
          <View style={styles.actionRow}>
            <ActionButton
              label={connecting ? 'Working…' : 'Connect & Run DKG'}
              onPress={handleConnect}
              disabled={connecting}
            />
            <ActionButton
              label="Disconnect"
              onPress={handleDisconnect}
              disabled={connecting}
              variant="secondary"
            />
          </View>
          {remoteWalletStatus === 'exists' && (
            <ActionButton
              label={recovering ? 'Recovering…' : 'Recover wallet'}
              onPress={handleRecover}
              disabled={recovering || connecting}
            />
          )}
        </ThemedView>

        <ThemedView style={styles.card}>
          <ThemedText type="subtitle">Wallet state</ThemedText>
          <StatusRow label="Status" value={status} valueColor={statusColor} />
          <StatusRow label="Session" value={sessionId ?? '—'} />
          <StatusRow label="Key ID" value={keyId ?? '—'} selectable />
          <StatusRow label="Remote wallet" value={remoteWalletLabel} />
          <StatusRow label="Address" value={address ?? '—'} selectable />
          <ActionButton label="Show key share & pubkey" onPress={handleShowKeyData} />
          {localShareHex && (
            <View style={styles.signatureBox}>
              <ThemedText type="defaultSemiBold">Local key share</ThemedText>
              <ThemedText selectable style={styles.mono}>
                {localShareHex}
              </ThemedText>
            </View>
          )}
          {publicKeyHex && (
            <View style={styles.signatureBox}>
              <ThemedText type="defaultSemiBold">Public key</ThemedText>
              <ThemedText selectable style={styles.mono}>
                {publicKeyHex}
              </ThemedText>
            </View>
          )}
          {pubkeyError && (
            <ThemedText style={{ color: 'red' }}>{pubkeyError}</ThemedText>
          )}
        </ThemedView>

        <ThemedView style={styles.card}>
          <ThemedText type="subtitle">Sign a message</ThemedText>
          <TextInput
            style={[styles.input, styles.textArea, { borderColor: Colors[colorScheme].tint, color: Colors[colorScheme].text }]}
            multiline
            value={message}
            onChangeText={setMessage}
          />
          <ActionButton label={signing ? 'Signing…' : 'Sign now'} onPress={handleSign} disabled={signing} />
          {signature && (
            <View style={styles.signatureBox}>
              <ThemedText type="defaultSemiBold">Signature ({signature.format})</ThemedText>
              <ThemedText selectable style={styles.mono}>
                {bytesToHex(signature.signature)}
              </ThemedText>
            </View>
          )}
        </ThemedView>

        {error && (
          <ThemedView style={[styles.card, styles.errorCard]}>
            <ThemedText type="subtitle" style={styles.errorTitle}>
              Error
            </ThemedText>
            <ThemedText selectable>{error}</ThemedText>
          </ThemedView>
        )}
      </ScrollView>
    </ParallaxScrollView>
  );
}

function StatusRow({
  label,
  value,
  valueColor,
  selectable,
}: {
  label: string;
  value: string;
  valueColor?: string;
  selectable?: boolean;
}) {
  return (
    <View style={styles.statusRow}>
      <ThemedText type="defaultSemiBold">{label}</ThemedText>
      <ThemedText selectable={selectable} style={[styles.statusValue, valueColor ? { color: valueColor } : null]}>
        {value}
      </ThemedText>
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  disabled,
  variant = 'primary',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const backgroundColor =
    variant === 'primary' ? Colors[colorScheme].tint : `${Colors[colorScheme].text}1A`;
  const textColor = variant === 'primary' ? '#ffffff' : Colors[colorScheme].text;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        {
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
          backgroundColor,
        },
      ]}>
      <ThemedText style={[styles.buttonLabel, { color: textColor }]}>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 16,
    paddingBottom: 64,
  },
  section: {
    gap: 8,
    paddingHorizontal: 16,
  },
  card: {
    padding: 16,
    borderRadius: 16,
    gap: 12,
    marginHorizontal: 16,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusValue: {
    textAlign: 'right',
    flexShrink: 1,
    marginLeft: 12,
  },
  signatureBox: {
    gap: 8,
  },
  mono: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 12,
  },
  errorCard: {
    borderWidth: 1,
    borderColor: '#ef4444',
  },
  errorTitle: {
    color: '#ef4444',
  },
  button: {
    flex: 1,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonLabel: {
    fontWeight: '600',
  },
  headerIcon: {
    position: 'absolute',
    right: 24,
    bottom: -40,
  },
});
