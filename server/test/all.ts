// Runs the whole server test suite: node --experimental-strip-types test/all.ts
// Each module is self-contained and asserts on import, so a plain import chain is the runner.
import './rating.test.ts';
import './matchmaking.test.ts';
import './db.test.ts';
import './sim.ts';

console.log('ALL PASSED');
