declare const process: {
  env?: Record<string, string | undefined>;
};

declare module 'react-native' {
  export const Platform: { OS: string };
  export const NativeModules: Record<string, unknown>;
}

interface FetchResponse {
  status: number;
  text(): Promise<string>;
}

declare function fetch(url: string, init?: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<FetchResponse>;
