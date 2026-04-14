export interface CDPSessionLike {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(event: string, listener: (payload: any) => void): this;
  off(event: string, listener: (payload: any) => void): this;
  detach(): Promise<void>;
  id?(): string;
}
