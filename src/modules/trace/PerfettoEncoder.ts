/**
 * Pure-TypeScript Perfetto protobuf encoder.
 *
 * Encodes a subset of the Perfetto trace protobuf schema sufficient to produce
 * traces that ui.perfetto.dev can render: TracePacket wrapping TrackEvent
 * slices + TrackDescriptor metadata, followed by length-delimited framing.
 *
 * NO external CLI dependency — the wire-format primitives (varint, fixed32,
 * fixed64, length-delimited) are implemented inline following the proto3
 * encoding spec.
 *
 * Schema subset used (field numbers from perfetto_trace.proto / trace_packet.proto):
 *   TracePacket
 *     timestamp           = 8  (uint64)
 *     timestamp_clock_id  = 58 (uint32)
 *     track_event         = 11 (TrackEvent)
 *     track_descriptor    = 60 (TrackDescriptor)
 *
 *   TrackDescriptor
 *     uuid      = 1 (uint64)
 *     name      = 2 (string)
 *     process   = 4 (ProcessDescriptor)
 *     thread    = 5 (ThreadDescriptor)
 *
 *   ProcessDescriptor
 *     pid          = 1 (int32)
 *     process_name = 2 (string)
 *
 *   ThreadDescriptor
 *     pid         = 1 (int32)
 *     tid         = 2 (int32)
 *     thread_name = 5 (string)
 *
 *   TrackEvent
 *     track_uuid    = 1  (uint64)
 *     type          = 9  (enum: TYPE_SLICE_BEGIN=1, TYPE_SLICE_END=2, TYPE_INSTANT=3)
 *     name          = 23 (string)
 *     categories    = 22 (repeated string)
 *     counter_value = 30 (double)
 */

// ── Wire-format primitives ──

/** Append a base-128 varint (little-endian, 7 bits per byte, MSB = continuation). */
function appendVarint(buf: number[], value: number): void {
  let v = Math.floor(value);
  if (v < 0) v = 0;
  do {
    let byte = v % 0x80;
    v = Math.floor(v / 0x80);
    if (v !== 0) byte |= 0x80;
    buf.push(byte);
  } while (v !== 0);
}

/** Wire type 0: varint field = tag + varint value. */
function fieldVarint(buf: number[], fieldNumber: number, value: number): void {
  appendVarint(buf, (fieldNumber << 3) | 0);
  appendVarint(buf, value);
}

/** Wire type 1: fixed64 field (e.g. proto3 double) = tag + 8 LE bytes. */
function fieldFixed64(buf: number[], fieldNumber: number, value: number): void {
  appendVarint(buf, (fieldNumber << 3) | 1);
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value, true); // little-endian IEEE 754
  for (let i = 0; i < 8; i += 1) {
    buf.push(view.getUint8(i));
  }
}

/** Wire type 2: length-delimited field = tag + varint-length + raw bytes. */
function fieldBytes(buf: number[], fieldNumber: number, data: Uint8Array): void {
  appendVarint(buf, (fieldNumber << 3) | 2);
  appendVarint(buf, data.length);
  for (let i = 0; i < data.length; i++) buf.push(data[i]!);
}

/** Wire type 2: length-delimited string field. */
function fieldString(buf: number[], fieldNumber: number, value: string): void {
  const encoded = new TextEncoder().encode(value);
  fieldBytes(buf, fieldNumber, encoded);
}

/** Wire type 2: length-delimited embedded message field. */
function fieldMessage(buf: number[], fieldNumber: number, body: number[]): void {
  fieldBytes(buf, fieldNumber, new Uint8Array(body));
}

// ── Message builders ──

function buildProcessDescriptor(pid: number, processName: string): number[] {
  const buf: number[] = [];
  fieldVarint(buf, 1, pid); // pid (int32, wire type 0)
  fieldString(buf, 2, processName); // process_name
  return buf;
}

function buildThreadDescriptor(pid: number, tid: number, threadName: string): number[] {
  const buf: number[] = [];
  fieldVarint(buf, 1, pid);
  fieldVarint(buf, 2, tid);
  if (threadName) fieldString(buf, 5, threadName);
  return buf;
}

function buildTrackDescriptor(params: {
  uuid: number;
  trackName: string;
  pid: number;
  tid: number;
  threadName: string;
}): number[] {
  const buf: number[] = [];
  fieldVarint(buf, 1, params.uuid); // uuid
  if (params.trackName) fieldString(buf, 2, params.trackName); // name
  // process descriptor
  const process = buildProcessDescriptor(params.pid, 'Browser');
  fieldMessage(buf, 4, process);
  // thread descriptor
  const thread = buildThreadDescriptor(params.pid, params.tid, params.threadName);
  fieldMessage(buf, 5, thread);
  return buf;
}

const PREAMBLE_FIELD_UUID = 1;
const PREAMBLE_FIELD_PROCESS = 4;
const PREAMBLE_FIELD_THREAD = 5;
// Keep unused for future expansion
void PREAMBLE_FIELD_UUID;
void PREAMBLE_FIELD_PROCESS;
void PREAMBLE_FIELD_THREAD;

export interface PerfettoSlice {
  name: string;
  category: string;
  timestampUs: number;
  durationUs: number;
  tid: number;
  pid: number;
}

export interface PerfettoCounter {
  name: string;
  category: string;
  timestampUs: number;
  value: number;
  tid: number;
  pid: number;
}

export interface PerfettoTrackDef {
  tid: number;
  pid: number;
  name: string;
  /** Unique uint64 track UUID. Derived from tid in our schema. */
  uuid: number;
}

/**
 * Encode a single TrackEvent message.
 * type: 1 = slice begin, 2 = slice end, 3 = instant
 */
function buildTrackEvent(params: {
  trackUuid: number;
  name: string;
  category: string;
  type: number;
  timestampUs: number;
  durationUs?: number;
  /** For TYPE_INSTANT counter events — encoded as double_counter_value (field 44). */
  counterValue?: number;
}): number[] {
  const buf: number[] = [];
  fieldVarint(buf, 11, params.trackUuid); // track_uuid
  fieldVarint(buf, 9, params.type); // type
  if (params.name) fieldString(buf, 23, params.name); // name
  if (params.category) fieldString(buf, 22, params.category); // categories
  if (params.counterValue !== undefined) {
    fieldFixed64(buf, 44, params.counterValue); // double_counter_value (double)
  }
  return buf;
}

/**
 * Encode a complete Perfetto binary trace from slices and counter events.
 *
 * Each event becomes a TracePacket:
 * 1. First, one TracePacket per unique track wraps a TrackDescriptor.
 * 2. Then, each slice becomes two TracePackets (begin + end), each wrapping a
 *    TrackEvent + timestamp.
 *
 * Output is a serialized `perfetto.protos.Trace`. Every packet is encoded as
 * the repeated field `Trace.packet` (field 1, wire type 2).
 */
export function encodePerfettoTrace(
  tracks: PerfettoTrackDef[],
  slices: PerfettoSlice[],
  counters: PerfettoCounter[],
): Uint8Array {
  const chunks: number[][] = [];

  // Descriptors are keyed by track.uuid, but events only carry a tid in this
  // schema. Resolve tid → uuid so slices/counters attach to the descriptor track.
  const uuidByTid = new Map<number, number>();
  for (const track of tracks) {
    uuidByTid.set(track.tid, track.uuid);
  }

  // 1. Track descriptors
  for (const track of tracks) {
    const descriptor = buildTrackDescriptor({
      uuid: track.uuid,
      trackName: track.name,
      pid: track.pid,
      tid: track.tid,
      threadName: track.name,
    });
    const packet = buildTracePacket({ trackDescriptor: descriptor });
    chunks.push(encodeTracePacketField(packet));
  }

  // 2. Slice events (begin + end for each, yielding X (Complete) events)
  for (const slice of slices) {
    // Begin
    const beginBody = buildTrackEvent({
      trackUuid: uuidByTid.get(slice.tid) ?? slice.tid,
      name: slice.name,
      category: slice.category,
      type: 1, // TYPE_SLICE_BEGIN
      timestampUs: slice.timestampUs,
    });
    const beginPacket = buildTracePacket({
      timestampUs: slice.timestampUs,
      trackEvent: beginBody,
    });
    chunks.push(encodeTracePacketField(beginPacket));

    // End
    const endBody = buildTrackEvent({
      trackUuid: uuidByTid.get(slice.tid) ?? slice.tid,
      name: slice.name,
      category: slice.category,
      type: 2, // TYPE_SLICE_END
      timestampUs: slice.timestampUs + slice.durationUs,
    });
    const endPacket = buildTracePacket({
      timestampUs: slice.timestampUs + slice.durationUs,
      trackEvent: endBody,
    });
    chunks.push(encodeTracePacketField(endPacket));
  }

  // 3. Counter events (counter-track points)
  for (const counter of counters) {
    const body: number[] = [];
    fieldVarint(body, 11, uuidByTid.get(counter.tid) ?? counter.tid); // track_uuid
    fieldVarint(body, 9, 4); // type = TYPE_COUNTER so Perfetto renders a counter track
    if (counter.name) fieldString(body, 23, counter.name);
    if (counter.category) fieldString(body, 22, counter.category);
    fieldFixed64(body, 44, counter.value); // double_counter_value (double)
    const packet = buildTracePacket({
      timestampUs: counter.timestampUs,
      trackEvent: body,
    });
    chunks.push(encodeTracePacketField(packet));
  }

  const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(totalLen);
  let pos = 0;
  for (const chunk of chunks) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  return out;
}

interface TracePacketParams {
  timestampUs?: number;
  trackDescriptor?: number[];
  trackEvent?: number[];
}

function buildTracePacket(params: TracePacketParams): number[] {
  const buf: number[] = [];
  if (params.timestampUs !== undefined) {
    fieldVarint(buf, 8, params.timestampUs); // timestamp (uint64)
    fieldVarint(buf, 58, 1); // timestamp_clock_id = BOOTTIME (1)
  }
  if (params.trackDescriptor) {
    fieldMessage(buf, 60, params.trackDescriptor);
  }
  if (params.trackEvent) {
    fieldMessage(buf, 11, params.trackEvent);
  }
  return buf;
}

/**
 * Wrap a serialized TracePacket as `Trace.packet` (field 1, wire type 2).
 */
function encodeTracePacketField(packet: number[]): number[] {
  const framed: number[] = [0x0a];
  appendVarint(framed, packet.length);
  return [...framed, ...packet];
}

/**
 * Encode a single varint + bytes (proto standard length-delimited) message
 * prefix — not used for the top-level file format but kept as a utility for
 * tests that verify individual message encoding.
 */
export function encodeVarintPrefixed(packet: number[]): number[] {
  const prefix: number[] = [];
  appendVarint(prefix, packet.length);
  return [...prefix, ...packet];
}
