// 输入块身份与 exportMdContent 接口返回的标准 Markdown，检查 I/O/service 契约。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createReminderRuntime } from 'dsh-context-care/reminders';
import { ReminderSources } from '../lib/rules.js';

const input = process.argv[2];
if (!input) throw new Error('Pass JSON with callout identity and markdown from /api/export/exportMdContent');
const block = JSON.parse(await readFile(input, 'utf8'));
const errors = [];
const runtime = createReminderRuntime({ save() {}, saveCapacity() {}, changed() {}, sinceSeq: () => -1, report: error => errors.push(String(error)) });
const source = ReminderSources.attach(runtime, ReminderSources.options(), async (key, roots, signal) => {
  assert.equal(key, 'live'); assert.equal(roots, undefined); signal.throwIfAborted(); return [block];
}, message => errors.push(message), () => ['live'], () => true, listener => {
  listener({ kind: 'ready', kernelId: 'live' }); return async () => {};
});
try {
  await source.refresh();
  const snapshot = runtime.snapshot('live-check');
  assert.deepEqual(errors, []); assert.deepEqual(snapshot.sources[0].diagnostics, []);
  assert.equal(snapshot.sources[0].rules.length, 1);
  const rule = snapshot.sources[0].rules[0];
  assert.equal(rule.schemaVersion, 2); assert.ok(rule.id.startsWith(`${block.id}:`));
  console.log(JSON.stringify({ blockId: block.id, type: block.type, schemaVersion: rule.schemaVersion, registered: true }));
} finally { await source.dispose(); await runtime.close(); }
