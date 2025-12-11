import { Platform } from 'react-native';
import { WebSocketTransport } from '@maanyio/mpc-coordinator-rn';
import { hexFromBytes, bytesToBase64 } from './bytes';
import { randomBytes } from './random';
import { readEnv } from './env';

const ANDROID_LOCALHOST = 'ws://10.0.2.2:8080';
const DEFAULT_LOCALHOST = 'ws://localhost:8080';
const READY_STATE_OPEN = 1;

const DEFAULT_SERVER_URL = Platform.OS === 'android' ? ANDROID_LOCALHOST : DEFAULT_LOCALHOST;

type CoordinatorWebSocket = Parameters<WebSocketTransport['attach']>[1];

export type SessionIntent = 'dkg' | 'sign' | 'refresh';

export interface ConnectToCoordinatorOptions {
  url?: string;
  token?: string;
  intent?: SessionIntent;
  keyId?: string;
  sessionId?: string;
  sessionIdHint?: string;
  message?: Uint8Array;
  messageEncoding?: 'base64' | 'hex';
}

interface RawSendCapableTransport extends WebSocketTransport {
  __maanySendText?: (payload: string) => Promise<void>;
}

export interface CoordinatorConnection {
  transport: WebSocketTransport;
  sessionId: string;
  close(): void;
}

interface HelloPayload {
  type: 'hello';
  sessionId: string;
  role: 'device';
  token?: string;
  intent?: SessionIntent;
  keyId?: string;
  sessionIdHint?: string;
  message?: string;
  messageEncoding?: 'base64' | 'hex';
}

type Listener = (...args: any[]) => void;

export async function connectToCoordinator(
  options: ConnectToCoordinatorOptions = {}
): Promise<CoordinatorConnection> {
  const sessionId = options.sessionId ?? hexFromBytes(randomBytes(16));
  const url = options.url ?? readEnv('EXPO_PUBLIC_MPC_SERVER_URL', 'MAANY_MPC_SERVER_URL') ?? DEFAULT_SERVER_URL;
  if (!url) {
    throw new Error('Maany MPC coordinator URL is not configured');
  }

  const socket = await openWebSocket(url);
  let closed = false;
  const handleClose: Listener = () => {
    closed = true;
  };
  addSocketListener(socket, 'close', handleClose);

  const hello: HelloPayload = {
    type: 'hello',
    sessionId,
    role: 'device',
    token: options.token,
    intent: options.intent ?? 'dkg',
    keyId: options.keyId,
    sessionIdHint: options.sessionIdHint,
  };
  if (options.message) {
    const encoding = options.messageEncoding ?? 'base64';
    hello.message = encoding === 'hex' ? hexFromBytes(options.message) : bytesToBase64(options.message);
    if (encoding !== 'base64') {
      hello.messageEncoding = encoding;
    }
  }
  console.log('[maany-sdk] connection: sending hello', hello);
  console.log('this is being updated')
  socket.send(JSON.stringify(hello));

  const transport = new WebSocketTransport() as RawSendCapableTransport;
  // Attach as 'server' so inbound frames land in the device queue.
  transport.attach('server', socket as unknown as CoordinatorWebSocket);
  transport.__maanySendText = (payload: string) => sendTextFrame(socket, payload);
  console.log('[maany-sdk] connection: transport attached for session', sessionId, 'as server peer');

  return {
    transport,
    sessionId,
    close: () => {
      transport.detach('server');
      delete transport.__maanySendText;
      removeSocketListener(socket, 'close', handleClose);
      if (!closed) {
        socket.close();
      }
      closed = true;
      console.log('[maany-sdk] connection: closed session', sessionId);
    },
  };
}

async function sendTextFrame(socket: WebSocket, payload: string): Promise<void> {
  if (socket.readyState !== READY_STATE_OPEN) {
    throw new Error(`Coordinator socket is not open (readyState=${socket.readyState})`);
  }
  await new Promise<void>((resolve, reject) => {
    try {
      socket.send(payload);
      resolve();
    } catch (error) {
      reject(error);
    }
  });
}

async function openWebSocket(url: string): Promise<WebSocket> {
  const WebSocketCtor = getWebSocketCtor();
  return new Promise((resolve, reject) => {
    const socket = new WebSocketCtor(url);
    if (typeof (socket as any).binaryType !== 'undefined') {
      (socket as any).binaryType = 'arraybuffer';
    }

    const handleOpen: Listener = () => {
      cleanup();
      resolve(socket);
    };

    const handleError = (event: { message?: string }) => {
      cleanup();
      const message = event?.message ?? 'Failed to connect to coordinator';
      reject(new Error(message));
    };

    const cleanup = () => {
      removeSocketListener(socket, 'open', handleOpen);
      removeSocketListener(socket, 'error', handleError);
    };

    addSocketListener(socket, 'open', handleOpen);
    addSocketListener(socket, 'error', handleError);
  });
}

function getWebSocketCtor(): typeof WebSocket {
  const ctor = (globalThis as unknown as { WebSocket?: typeof WebSocket }).WebSocket;
  if (!ctor) {
    throw new Error('WebSocket constructor is not available in this environment');
  }
  return ctor;
}

function addSocketListener(socket: WebSocket, type: string, listener: Listener) {
  if (typeof socket.addEventListener === 'function') {
    socket.addEventListener(type, listener as EventListener);
    return;
  }
  const key = getEventKey(type);
  if (!key) return;
  const current = (socket as any)[key] as Listener | undefined;
  (socket as any)[key] = (...args: any[]) => {
    if (typeof current === 'function') {
      current(...args);
    }
    listener(...args);
  };
}

function removeSocketListener(socket: WebSocket, type: string, listener: Listener) {
  if (typeof socket.removeEventListener === 'function') {
    socket.removeEventListener(type, listener as EventListener);
    return;
  }
  const key = getEventKey(type);
  if (!key) return;
  const current = (socket as any)[key];
  if (current === listener) {
    (socket as any)[key] = undefined;
  }
}

function getEventKey(type: string): 'onopen' | 'onclose' | 'onerror' | 'onmessage' | null {
  switch (type) {
    case 'open':
      return 'onopen';
    case 'close':
      return 'onclose';
    case 'error':
      return 'onerror';
    case 'message':
      return 'onmessage';
    default:
      return null;
  }
}
