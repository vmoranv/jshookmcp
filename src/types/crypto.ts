import type { CodeLocation } from '@internal-types/common';

export interface DetectCryptoOptions {
  code: string;
  testData?: unknown;
}

export interface DetectCryptoResult {
  algorithms: CryptoAlgorithm[];
  libraries: CryptoLibrary[];
  confidence: number;
}

export interface CryptoAlgorithm {
  name: string;
  type: 'symmetric' | 'asymmetric' | 'hash' | 'encoding';
  confidence: number;
  location: CodeLocation;
  parameters?: CryptoParameters;
  usage: string;
}

export interface CryptoParameters {
  key?: string;
  iv?: string;
  mode?: string;
  padding?: string;
}

export interface CryptoLibrary {
  name: string;
  version?: string;
  confidence: number;
}
