/**
 * Runtime integration test for DarwinAPI — exercises the REAL Mach FFI on the
 * host (no koffi mock) for the entitlement-free, self-process paths.
 *
 * This narrows the "runtime-unverified" honest boundary for the Darwin
 * access-breakpoint engine: the Mach VM FFI layer (page size, self task port,
 * receive-right allocation, region query, protect round-trip on a fresh page,
 * allocate/deallocate) is proven against real libSystem.B.dylib on macOS.
 *
 * What stays genuinely unverified (cannot be pushed on this host):
 *  - full EXC_BAD_ACCESS capture via the mach_msg receive loop on a *target*
 *    process (needs a faulting target + debugger entitlement + a correct
 *    reply or the process dies),
 *  - cross-process task_for_pid for other PIDs (debugger entitlement).
 * taskForPid on the host's OWN pid is exercised here and documents whether the
 * entitlement is required on this particular build.
 */
import { describe, it, expect } from 'vitest';
import {
  KERN,
  VM_PROT,
  hostPageSize,
  isKoffiAvailableOnDarwin,
  machPortAllocateReceive,
  machPortDeallocate,
  machTaskSelf,
  machVmAllocate,
  machVmDeallocate,
  machVmProtect,
  machVmRegion,
  taskForPid,
} from '@src/native/platform/darwin/DarwinAPI';

const VM_FLAGS_ANYWHERE = 1; // let the kernel choose the address

describe.skipIf(process.platform !== 'darwin')(
  'DarwinAPI — real Mach FFI (runtime, host=macOS)',
  () => {
    it('koffi loads libSystem.B.dylib on this host', () => {
      expect(isKoffiAvailableOnDarwin()).toBe(true);
    });

    it('hostPageSize returns a sane page size (16384 Apple Silicon / 4096 Intel)', () => {
      const ps = hostPageSize();
      expect(ps === 4096 || ps === 16384).toBe(true);
    });

    it('machTaskSelf returns a valid (nonzero) task port', () => {
      expect(machTaskSelf()).toBeGreaterThan(0);
    });

    it('machPortAllocateReceive allocates a real Mach receive right (constant fix: RIGHT=1)', () => {
      // Previously returned KERN_INVALID_VALUE (18) because MACH_PORT_RIGHT_RECEIVE
      // was mis-set to 0 (SEND); the correct value is 1 (mach/port.h). Now succeeds
      // against real libSystem without any entitlement.
      const self = machTaskSelf();
      const port = machPortAllocateReceive();
      expect(port).toBeGreaterThan(0);
      // Best-effort release. mach_port_deallocate is for SEND rights; releasing a
      // RECEIVE right returns KERN_INVALID_RIGHT (17) — proper release needs
      // mach_port_mod_refs/destroy (a separate API, tracked as a teardown gap).
      const deallocKr = machPortDeallocate(self, port);
      expect(deallocKr === 0 || deallocKr === 17).toBe(true);
    });

    it('machVmAllocate + machVmRegion + protect round-trip + deallocate on a fresh region', () => {
      const self = machTaskSelf();
      const pageSize = BigInt(hostPageSize());

      // Allocate a fresh region nobody else uses (safe to protect — never accessed).
      const alloc = machVmAllocate(self, pageSize, VM_FLAGS_ANYWHERE);
      expect(alloc.kr).toBe(KERN.SUCCESS);
      expect(alloc.address).toBeGreaterThan(0n);

      // Query the region we just allocated.
      const region = machVmRegion(self, alloc.address);
      expect(region.kr).toBe(KERN.SUCCESS);

      // Protect round-trip: NONE → READ|WRITE. We do NOT touch the page between
      // the two calls, so there is zero fault risk; this verifies mach_vm_protect
      // works in both directions against real libSystem.
      const krNone = machVmProtect(self, alloc.address, pageSize, false, VM_PROT.NONE);
      const krRW = machVmProtect(
        self,
        alloc.address,
        pageSize,
        false,
        VM_PROT.READ | VM_PROT.WRITE,
      );
      expect(krNone).toBe(KERN.SUCCESS);
      expect(krRW).toBe(KERN.SUCCESS);

      // Cleanup.
      expect(machVmDeallocate(self, alloc.address, pageSize)).toBe(KERN.SUCCESS);
    });

    it('taskForPid(self, own pid) — FFI binding works (entitlement-free success OR documented KERN_FAILURE)', () => {
      const self = machTaskSelf();
      const { kr, task } = taskForPid(self, process.pid);
      // Either the host allows task_for_pid on the caller's own pid
      // (KERN_SUCCESS + a valid task port), or it requires the debugger
      // entitlement (KERN_FAILURE). Both outcomes prove the FFI declaration is
      // valid; only cross-process / target attach is gated by the entitlement.
      expect(typeof kr).toBe('number');
      if (kr === KERN.SUCCESS) {
        expect(task).toBeGreaterThan(0);
      } else {
        expect(kr).toBe(KERN.FAILURE); // entitlement-gated on this build
      }
    });
  },
);
