export { V8InspectorHandlers } from './impl';
export type { V8InspectorDomainDependencies } from './impl';
export { default } from './impl';
export {
  clearSnapshotCache,
  getSnapshot,
  getSnapshotCache,
  storeSnapshot,
  handleHeapSnapshotCapture,
  handleHeapSearch,
} from './heap-snapshot';
export { handleBytecodeExtract } from './bytecode-extract';
export { handleJitInspect } from './jit-inspect';
