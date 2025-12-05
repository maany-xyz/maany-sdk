export class CosmosUtilsError extends Error {
  code: string;
  data?: unknown;

  constructor(message: string, code: string, data?: unknown) {
    super(message);
    this.name = 'CosmosUtilsError';
    this.code = code;
    this.data = data;
  }
}

export class NetworkError extends CosmosUtilsError {
  constructor(message: string, data?: unknown) {
    super(message, 'NETWORK_ERROR', data);
    this.name = 'NetworkError';
  }
}

export class CosmosError extends CosmosUtilsError {
  constructor(message: string, data?: unknown) {
    super(message, 'COSMOS_ERROR', data);
    this.name = 'CosmosError';
  }
}

export class SerializationError extends CosmosUtilsError {
  constructor(message: string, data?: unknown) {
    super(message, 'SERIALIZATION_ERROR', data);
    this.name = 'SerializationError';
  }
}
