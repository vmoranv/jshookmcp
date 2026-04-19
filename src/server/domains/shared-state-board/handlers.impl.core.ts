/**
 * SharedStateBoard domain — composition facade.
 *
 * State store and utilities in ./handlers/shared.ts.
 * Handler methods delegated to StoreHandlers, WatchHandlers, IOHandlers.
 */

export * from './definitions';

import { StateBoardStore } from './handlers/shared';
import { StoreHandlers } from './handlers/store-handlers';
import { WatchHandlers } from './handlers/watch-handlers';
import { IOHandlers } from './handlers/io-handlers';

export type { StateEntry, StateChangeRecord, StateWatch, StateBoardStats } from './handlers/shared';

export class SharedStateBoardHandlers {
  private store: StateBoardStore;
  private storeHandlers: StoreHandlers;
  private watchHandlers: WatchHandlers;
  private ioHandlers: IOHandlers;

  constructor() {
    this.store = new StateBoardStore();
    this.storeHandlers = new StoreHandlers(this.store);
    this.watchHandlers = new WatchHandlers(this.store);
    this.ioHandlers = new IOHandlers(this.store);
  }

  setPersistNotifier(notify?: () => void): void {
    this.store.setPersistNotifier(notify);
  }

  handleSet(args: Record<string, unknown>) {
    return this.storeHandlers.handleSet(args);
  }
  handleGet(args: Record<string, unknown>) {
    return this.storeHandlers.handleGet(args);
  }
  handleDelete(args: Record<string, unknown>) {
    return this.storeHandlers.handleDelete(args);
  }
  handleList(args: Record<string, unknown>) {
    return this.storeHandlers.handleList(args);
  }
  handleWatchDispatch(args: Record<string, unknown>) {
    const action = String(args['action'] ?? '');
    if (action === 'stop') return this.watchHandlers.handleUnwatch(args);
    return this.watchHandlers.handleWatch(args);
  }
  handleIODispatch(args: Record<string, unknown>) {
    const action = String(args['action'] ?? '');
    if (action === 'import') return this.ioHandlers.handleImport(args);
    return this.ioHandlers.handleExport(args);
  }
  handleWatch(args: Record<string, unknown>) {
    return this.watchHandlers.handleWatch(args);
  }
  handleUnwatch(args: Record<string, unknown>) {
    return this.watchHandlers.handleUnwatch(args);
  }
  handlePoll(args: Record<string, unknown>) {
    return this.watchHandlers.handlePoll(args);
  }
  handleHistory(args: Record<string, unknown>) {
    return this.ioHandlers.handleHistory(args);
  }
  handleExport(args: Record<string, unknown>) {
    return this.ioHandlers.handleExport(args);
  }
  handleImport(args: Record<string, unknown>) {
    return this.ioHandlers.handleImport(args);
  }
  handleClear(args: Record<string, unknown>) {
    return this.storeHandlers.handleClear(args);
  }
  handleStats() {
    return this.storeHandlers.handleStats();
  }

  cleanupExpired(): number {
    return this.store.cleanupExpired();
  }

  getStore(): StateBoardStore {
    return this.store;
  }
}
