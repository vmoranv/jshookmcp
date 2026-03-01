export type NetworkInitiator = unknown;
export type NetworkTiming = unknown;

export interface NetworkRequest {
  requestId: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  postData?: string;
  timestamp: number;
  type?: string;
  initiator?: NetworkInitiator;
}

export interface NetworkResponse {
  requestId: string;
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  mimeType: string;
  timestamp: number;
  fromCache?: boolean;
  timing?: NetworkTiming;
}
