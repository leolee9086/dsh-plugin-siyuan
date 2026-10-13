// Cross-checkout verification uses the callout returned by the real SiYuan kernel.
// Supply the care checkout explicitly; it is not a runtime dependency of this plugin.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ReminderSources } from '../lib/rules.js';

const checkout = process.env.DSH_TEST_CARE_CHECKOUT;
if (!checkout) throw new Error('Set DSH_TEST_CARE_CHECKOUT to the context-care checkout');
const { createReminderRuntime } = await import(pathToFileURL(resolve(checkout, 'src/reminder-runtime/index.js')));
const { createBoundedMatcher } = await import(pathToFileURL(resolve(checkout, 'src/bounded-matcher.js')));
const block = JSON.parse(await readFile(new URL('./fixtures/reminder-callout-live.json', import.meta.url), 'utf8'));
const rule = ReminderSources.parseCallout(block);
assert.equal(rule.id, `${block.id}:typescript-no-any`);
assert.equal(rule.when.arguments.file_path.regex, '\\.ts$');
assert.match(rule.text, /禁止使用 `any`/);
assert.match(rule.title, /💡 TypeScript 类型约定/);

// Production preparation and dispatch preserve the default 250ms / 1000ms budgets.
const matcher = createBoundedMatcher({ timeoutMs: 250, maxPending: 4, maxIdle: 4 });
await matcher.warmup();
const runtime = createReminderRuntime({ dispatches: true, execute: (input, signal, timing) => matcher.detect(input, signal, timing) });
const errors = [];
// Replay the real SQL row through source discovery and registration, not a hand-built rule source.
const sources = ReminderSources.attach(runtime, ReminderSources.options(), async (kernelId, roots, signal) => {
  assert.equal(kernelId, 'live'); assert.equal(roots, undefined); assert.ok(signal);
  return [block];
}, message => errors.push(message), () => ['live'], () => true, listener => {
  listener({ kind: 'ready', kernelId: 'live' }); return async () => {};
});
try {
  await sources.refresh();
  assert.deepEqual(errors, []);
  assert.equal(runtime.catalog('live-check')[0].rules.length, 1);
  const submit = (callId, file_path) => runtime.submit({ sessionId: 'live-check', callId, rootCallId: callId, name: 'read', arguments: { file_path } });
  const collect = visible => runtime.collect({ sessionId: 'live-check', visible });
  await submit('non-ts', 'code.ts.txt');
  assert.deepEqual(await collect([]), []);
  await submit('first-ts', 'code.ts');
  const messages = await collect([]);
  assert.equal(messages.length, 1, JSON.stringify(runtime.snapshot('live-check').diagnostics));
  assert.equal(messages[0].content[0].text, rule.text);
  await submit('second-ts', 'types.d.ts');
  assert.deepEqual(await collect(messages), []);
  await submit('third-ts', 'OTHER.TS');
  assert.deepEqual(await collect([...messages, { id: 'ordinary', role: 'user', content: [{ type: 'text', text: '继续' }] }]), []);
  console.log(JSON.stringify({ blockId: block.id, type: block.type, parsed: true, realWorker: true, initialMessages: messages.length, duplicateMessages: 0, productionDeadlines: true }, null, 2));
} finally {
  await sources.dispose();
  await runtime.close();
  await matcher.close();
}
