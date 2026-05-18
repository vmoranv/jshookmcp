declare module 'yauzl' {
  import type { Readable } from 'node:stream';

  export interface Entry {
    fileName: string;
    compressedSize?: number;
    uncompressedSize?: number;
  }

  export interface ZipFile {
    readEntry(): void;
    openReadStream(entry: Entry, callback: (error: Error | null, stream?: Readable) => void): void;
    close(): void;
    on(event: 'entry', listener: (entry: Entry) => void): this;
    on(event: 'end', listener: () => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    removeListener(event: 'entry', listener: (entry: Entry) => void): this;
    removeListener(event: 'end', listener: () => void): this;
    removeListener(event: 'error', listener: (error: Error) => void): this;
  }

  export interface OpenOptions {
    autoClose?: boolean;
    lazyEntries?: boolean;
    decodeStrings?: boolean;
    validateEntrySizes?: boolean;
    strictFileNames?: boolean;
  }

  export function open(
    path: string,
    options: OpenOptions,
    callback: (error: Error | null, zipFile?: ZipFile) => void,
  ): void;
}
