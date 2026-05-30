# scripts/dev-probes/

Local, **non-CI** developer probes for the `native-emulator` ARM64 interpreter.

These are *not* part of the test suite and are *not* run by any `package.json`
script or git hook. They exist to be run by hand against real Android `.so`
binaries that live only on a developer's machine (no `.so` is ever committed).
They are tracked in git so the next person can reuse them, but they should not
be treated as production code — expect to edit them per investigation.

| Script | What it does | How to run |
|--------|--------------|-----------|
| `native-emulator-probe.ts` | Loads every `lib/arm64-v8a/*.so` under a sample-artifacts root, relocates it, invokes exported symbols, and prints a histogram of opcodes that still throw "Unsupported ARM64 opcode". The empirical ISA-gap tracker. | `npx tsx scripts/dev-probes/native-emulator-probe.ts [rootDir]` |
| `native-emulator-bench.ts` | Throughput micro-benchmark (ns/instruction) of the interpreter hot loop. Zero deps. | `npx tsx scripts/dev-probes/native-emulator-bench.ts` |

Always run with **`tsx`** (not bare `node`) — these import via path/relative
references that `tsx` resolves but `node` does not.
