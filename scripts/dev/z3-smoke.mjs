// Smoke test: verify z3-solver WASM loads in this Node/ESM environment.
// Run: node --experimental-vm-modules scripts/dev/z3-smoke.mjs  (or just node scripts/dev/z3-smoke.mjs on Node 22)
import { init } from 'z3-solver';

const t0 = Date.now();
console.log('[smoke] typeof SharedArrayBuffer =', typeof SharedArrayBuffer);
if (typeof SharedArrayBuffer === 'undefined') {
  console.error('[smoke] FAIL: SharedArrayBuffer not available');
  process.exit(1);
}

try {
  const { Context } = await init();
  const elapsed = Date.now() - t0;
  console.log(`[smoke] init() OK in ${elapsed}ms`);

  const { Solver, Int, And } = new Context('main');
  const x = Int.const('x');
  const solver = new Solver();
  solver.set('timeout', 5000);
  solver.add(And(x.ge(0), x.le(9)));

  const res = await solver.check();
  console.log('[smoke] check() =', res);

  if (res !== 'sat') {
    console.error('[smoke] FAIL: expected sat');
    process.exit(1);
  }

  const model = solver.model();
  const xv = model.get(x);
  console.log('[smoke] model x =', xv ? xv.toString() : 'null');

  // UNSAT case
  const solver2 = new Solver();
  solver2.set('timeout', 5000);
  solver2.add(And(x.gt(10), x.lt(5)));
  const res2 = await solver2.check();
  console.log('[smoke] unsat check() =', res2);

  if (res2 !== 'unsat') {
    console.error('[smoke] FAIL: expected unsat, got', res2);
    process.exit(1);
  }

  console.log('[smoke] ALL PASS');
  process.exit(0);
} catch (err) {
  console.error('[smoke] FAIL: init threw:', err);
  process.exit(1);
}
