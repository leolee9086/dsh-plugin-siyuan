import test from 'node:test';
import assert from 'node:assert/strict';
import { ReminderSources } from '../../lib/rules.js';

const block = { id: '20251211093951-xtkv05z', root_id: '20251211093950-abcdefg', type: 'callout', subtype: 'DSH-REMINDER',
  markdown: '> [!DSH-REMINDER] 类型约定\n>\n> ```dsh-rule\n> arbitrary: remains unparsed\n> ```\n>\n> 保留正文。' };

test('SiYuan adapter only extracts native callout identity and plain document text', () => {
  assert.deepEqual(ReminderSources.documents([block]), [{ id: block.id, rootId: block.root_id, title: '类型约定',
    text: '```dsh-rule\narbitrary: remains unparsed\n```\n\n保留正文。' }]);
  assert.equal(Object.hasOwn(ReminderSources, 'parseCallout'), false);
});

test('adapter excludes other native block types and callout consumers', () => {
  for (const subtype of ['TIP', 'DSH-OTHER', 'DSH-REMINDER-EXTRA']) {
    assert.deepEqual(ReminderSources.documents([{ ...block, subtype }]), []);
    assert.deepEqual(ReminderSources.documents([{ ...block, markdown: block.markdown.replace('DSH-REMINDER', subtype) }]), []);
  }
  assert.deepEqual(ReminderSources.documents([{ ...block, type: 'b' }]), []);
});

test('adapter preserves malformed rule text so the engine owns diagnostics', () => {
  for (const text of ['incomplete', '```dsh-rule\nid: first\nid: second\n```', '```dsh-rule\nformat: reminder/v4\n```']) {
    const result = ReminderSources.documents([{ ...block, markdown: '[!DSH-REMINDER] title\n' + text }]);
    assert.equal(result.length, 1); assert.equal(result[0].text, text);
  }
});

test('adapter preserves IAL-shaped literals in YAML, fenced code and inline examples', () => {
  const body = ['```dsh-rule', 'template: "{: id=example} 不得删除"', '```', '',
    '```text', '{: id="code-example"}', '```', '', '行内 `{: id="inline-example"}` 和 {普通} 大括号。'].join('\n');
  const markdown = '> [!DSH-REMINDER] title\n>\n' + body.split('\n').map(line => '> ' + line).join('\n');
  assert.equal(ReminderSources.documents([{ ...block, markdown }])[0].text, body);
});

test('IO configuration validates only polling cadence and rejects malformed native rows', () => {
  assert.deepEqual(ReminderSources.options(), { refreshMs: 30000 });
  assert.deepEqual(ReminderSources.options({ apiUrl: 'http://local', reminders: { refreshMs: 1000 } }), { refreshMs: 1000 });
  for (const refreshMs of [null, '1000', 999, 3600001, 1.5]) assert.throws(() => ReminderSources.options({ reminders: { refreshMs } }));
  assert.throws(() => ReminderSources.options({ reminders: { roots: [] } }));
  assert.throws(() => ReminderSources.documents([{ ...block, markdown: undefined }]));
});
