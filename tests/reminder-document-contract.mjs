// Validate authored examples through the same I/O adapter and installed public service.
// This checks interface compatibility; engine algorithms are tested in the engine package.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createReminderRuntime } from 'dsh-context-care/reminders';
import { ReminderSources } from '../lib/rules.js';

const rows = [];
for (const file of ['../README.md', '../docs/规则编写教程.md']) {
  const text = await readFile(new URL(file, import.meta.url), 'utf8');
  for (const match of text.matchAll(/^````markdown\r?\n([\s\S]*?)^````/gm)) {
    rows.push({ id: `example-${rows.length}`, root_id: file, type: 'callout', subtype: 'DSH-REMINDER', markdown: match[1].trim() });
  }
}
assert.equal(rows.length, 5, 'all full callout examples must be checked');
const errors = [];
const runtime = createReminderRuntime({ save() {}, saveCapacity() {}, changed() {}, sinceSeq: () => -1, report: error => errors.push(String(error)) });
const source = ReminderSources.attach(runtime, ReminderSources.options(), async () => rows,
  message => errors.push(message), () => ['docs'], () => true, listener => {
    listener({ kind: 'ready', kernelId: 'docs' }); return async () => {};
  });
try {
  await source.refresh();
  const snapshot = runtime.snapshot('docs');
  assert.deepEqual(errors, []);
  assert.equal(snapshot.sources.length, 1);
  assert.deepEqual(snapshot.sources[0].diagnostics, []);
  assert.equal(snapshot.sources[0].rules.length, rows.length);
  assert.ok(snapshot.sources[0].rules.every(rule => rule.schemaVersion === 2));
  console.log(`Documentation contract: ${rows.length} callouts cross native extraction and canonical engine registration`);
} finally { await source.dispose(); await runtime.close(); }
