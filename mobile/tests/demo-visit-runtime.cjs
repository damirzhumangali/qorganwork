const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');
const moduleObject = { exports: {} };
const { code } = babel.transformSync(fs.readFileSync(require('node:path').join(__dirname, '../src/demoVisitRuntime.js'), 'utf8'), {
  configFile: false, babelrc: false, plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')],
});
vm.runInNewContext(code, { module: moduleObject, exports: moduleObject.exports });
const { createDemoVisitRunner, notifyDemoVisitChanges, subscribeDemoVisitChanges } = moduleObject.exports;

test('app-wide sync ignores suspended ticks, resumes once and never overlaps writes', async () => {
  let active = false; let calls = 0; let resolve; const results = [];
  const runner = createDemoVisitRunner({ isActive: () => active,
    sync: () => { calls++; return new Promise(done => { resolve = done; }); },
    onResult: value => results.push(value), onError: error => assert.fail(error) });
  await runner.tick(); assert.equal(calls, 0);
  active = true; const pending = runner.tick();
  await runner.tick(); assert.equal(calls, 1);
  resolve({ changed: true, marked: 2 }); await pending;
  assert.equal(results[0].marked, 2);
  const pendingAfterResume = runner.tick(); assert.equal(calls, 2);
  runner.stop(); resolve({ changed: true, marked: 1 }); await pendingAfterResume;
  await runner.tick(); assert.equal(calls, 2); assert.equal(results.length, 1, 'unmounted app receives no stale update');
});

test('failed saves report failure, allow retry and do not publish successful marks', async () => {
  let fail = true; const failures = []; const results = [];
  const runner = createDemoVisitRunner({ isActive: () => true,
    sync: async () => { if (fail) throw Error('Storage unavailable'); return { changed: true, marked: 1 }; },
    onResult: result => results.push(result), onError: error => failures.push(error.message) });
  await runner.tick(); assert.equal(results.length, 0); assert.equal(failures.length, 1);
  fail = false; await runner.tick(); assert.equal(results.length, 1);
  runner.stop();
});

test('visible trip resources subscribe to committed changes and clean up on navigation', () => {
  let first = 0; let second = 0;
  const removeFirst = subscribeDemoVisitChanges(() => first++);
  const removeSecond = subscribeDemoVisitChanges(() => second++);
  notifyDemoVisitChanges(); assert.equal(first, 1); assert.equal(second, 1);
  removeFirst(); notifyDemoVisitChanges(); assert.equal(first, 1); assert.equal(second, 2);
  removeSecond(); notifyDemoVisitChanges(); assert.equal(second, 2);
});
