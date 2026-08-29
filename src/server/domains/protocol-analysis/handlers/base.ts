/**
 * ProtocolAnalysisBaseHandlers — shared state, events, and lazy engines.
 */

import type { StateMachine } from '@modules/protocol-analysis';
import { ProtocolPatternEngine, StateMachineInferrer } from '@modules/protocol-analysis';
import type { EventBus, ServerEventMap } from '@server/EventBus';
import { DetailedDataManager } from '@utils/DetailedDataManager';
import type { ProtocolAtomicEvent, ProtocolAtomicEventPayload } from './shared';

export const EMPTY_STATE_MACHINE: StateMachine = {
  states: [],
  transitions: [],
  initial: '',
  initialState: '',
  finalStates: [],
};

export class ProtocolAnalysisBaseHandlers {
  protected engine?: ProtocolPatternEngine;
  protected inferrer?: StateMachineInferrer;
  protected eventBus?: EventBus<ServerEventMap>;
  /** MCP 2.0 Tasks scheduler — set via manifest ensure() for task-aware tools (pcapng_read). */
  protected taskManager?: import('@server/tasks/TaskManager').TaskManager;
  /** Shared large-response sink; lazy-init via getInstance() so tests can reset it. */
  protected readonly detailedDataManager: DetailedDataManager = DetailedDataManager.getInstance();

  constructor(
    engine?: ProtocolPatternEngine,
    inferrer?: StateMachineInferrer,
    eventBus?: EventBus<ServerEventMap>,
    taskManager?: import('@server/tasks/TaskManager').TaskManager,
  ) {
    this.engine = engine;
    this.inferrer = inferrer;
    this.eventBus = eventBus;
    this.taskManager = taskManager;
  }

  protected emitEvent<K extends ProtocolAtomicEvent>(
    event: K,
    payload: ProtocolAtomicEventPayload<K>,
  ): void {
    void this.eventBus?.emit(event, {
      ...payload,
      timestamp: new Date().toISOString(),
    } as ServerEventMap[K]);
  }

  protected getEngine(): ProtocolPatternEngine {
    if (!this.engine) {
      this.engine = new ProtocolPatternEngine();
    }

    return this.engine;
  }

  protected getInferrer(): StateMachineInferrer {
    if (!this.inferrer) {
      this.inferrer = new StateMachineInferrer();
    }

    return this.inferrer;
  }

  protected errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
