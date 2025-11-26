export function readEnv(...keys: string[]): string | undefined {
  if (typeof process === 'undefined' || typeof process.env !== 'object') {
    return undefined;
  }
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return undefined;
}
