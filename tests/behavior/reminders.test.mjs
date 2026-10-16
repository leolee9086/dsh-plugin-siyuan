import test from 'node:test';
import assert from 'node:assert/strict';
import { ReminderSources } from '../../lib/rules.js';
const id = '20251211093951-xtkv05z';
const markdown = '> [!DSH-REMINDER] 类型约定\n>\n> ```dsh-rule\n> format: reminder/v1\n> id: no-any\n> on: tool.succeeded\n> when:\n>   tool: read\n>   arguments:\n>     file_path:\n>       regex: \'\\.ts$\'\n> deliver:\n>   model:\n>     once: surface\n> ```\n>\n> 禁止使用 any。';
const block = { id, root_id: '20251211093950-abcdefg', type: 'callout', subtype: 'DSH-REMINDER', markdown };

test('reminder namespace yields a readable declaration and excludes other consumers', () => {
  const result = ReminderSources.parseCallout(block);
  assert.equal(result.id, `${id}:no-any`);
  assert.equal(result.text, '禁止使用 any。');
  assert.equal(result.when.arguments.file_path.regex, '\\.ts$');
  for (const subtype of ['TIP', 'DSH-OTHER', 'DSH-REMINDER-EXTRA']) {
    assert.equal(ReminderSources.parseCallout({ ...block, subtype, markdown: markdown.replace('DSH-REMINDER', subtype) }), undefined);
  }
  assert.equal(ReminderSources.parseCallout({ ...block, type: 'b' }), undefined);
  assert.throws(() => ReminderSources.parseCallout({ ...block, markdown: markdown.replace('DSH-REMINDER', 'DSH-OTHER') }), /标记/);
});

test('owned callouts report missing declarations and duplicate YAML keys', () => {
  assert.throws(() => ReminderSources.parseCallout({ ...block, markdown: '> [!DSH-REMINDER] incomplete' }), /代码块/);
  assert.throws(() => ReminderSources.parseCallout({ ...block, markdown: markdown.replace('> id: no-any', '> id: first\n> id: second') }), /unique|重复/i);
  assert.throws(() => ReminderSources.options({ reminders: { roots: [] } }), /未知/);
});

test('request reminders retain v2 time windows and human-presence declarations', () => {
  const declaration = { format: 'reminder/v2', id: 'night', on: 'request.before',
    when: { timeWindow: { start: '23:00', end: '06:00', timeZone: 'local' }, humanActivity: { withinSeconds: 300 } },
    deliver: { model: { once: 'window' } } };
  const markdown = `[!DSH-REMINDER] 晚间休息\n\n\`\`\`dsh-rule\n${JSON.stringify(declaration)}\n\`\`\`\n没有紧急任务时温和建议伙伴早点休息。`;
  const parsed = ReminderSources.parseCallout({ ...block, markdown });
  assert.deepEqual(parsed, { ...declaration, id: `${id}:night`, title: '晚间休息', text: '没有紧急任务时温和建议伙伴早点休息。' });
  assert.throws(() => ReminderSources.parseCallout({ ...block, markdown: markdown.replace('reminder/v2', 'reminder/v99') }), /format/);
});

test('callouts preserve output scopes, shared quotas and structured failure conditions', () => {
  const declarations = [
    { format: 'reminder/v3', id: 'output', on: 'assistant.output',
      scope: { sessionIds: ['one', 'two'], agentPresets: ['writing'] },
      when: { blockTypes: ['text', 'reasoning'], pattern: { kind: 'literal', text: '完成' } },
      deliver: { model: { once: 'surface', interrupt: 'abort-resume', shared: { reset: 'lifetime', lifetime: 'campaign', limit: 2 } } } },
    { format: 'reminder/v1', id: 'timeout', on: 'tool.failed', when: { tool: 'pwsh', error: { code: 'TOOL_TIMEOUT' } },
      deliver: { model: { once: 'surface' } } },
  ];
  for (const declaration of declarations) {
    const markdown = `[!DSH-REMINDER] 提醒\n\n\`\`\`dsh-rule\n${JSON.stringify(declaration)}\n\`\`\`\n核对结果。`;
    assert.deepEqual(ReminderSources.parseCallout({ ...block, markdown }),
      { ...declaration, id: `${id}:${declaration.id}`, title: '提醒', text: '核对结果。' });
  }
});

// These are source facilities, not a fabricated Host context. SQL is exercised separately against SiYuan.
function fixture(initial, options = {}) {
  const registered = new Map(), policies = new Map(), errors = [], calls = [];
  const state = { rows: initial, kernels: ['local'], selected: 'local', offline: false, writes: 0, cap: 0, validations: 0, gate: undefined };
  const accept = source => {
    if (state.cap && source.rules.length > state.cap) throw Object.assign(new Error('capacity'), { code: 'reminder-capacity-exceeded' });
    state.writes++; registered.set(source.sourceId, source);
  };
  const service = { validateRule: rule => { state.validations++; if (rule.text === '校验拒绝。') throw new Error('invalid rule'); return rule; }, registerSource(source, policy) {
    accept(source); policies.set(source.sourceId, policy);
    return { replace: accept,
      dispose() { registered.delete(source.sourceId); policies.delete(source.sourceId); } };
  } };
  let notify;
  const sources = ReminderSources.attach(service, ReminderSources.options({ reminders: options }), async (kernelId, roots, signal) => {
    assert.ok(signal); assert.equal(kernelId, 'local');
    calls.push({ roots });
    const gate = state.gate; state.gate = undefined;
    if (gate) await gate();
    if (state.offline) throw new Error('offline');
    const rows = state.rows.filter(row => row.type === 'callout' && row.subtype === 'DSH-REMINDER' && (!roots || roots.includes(row.root_id)))
      .sort((a, b) => a.id.localeCompare(b.id));
    return rows;
  }, message => errors.push(message), () => state.kernels, kernel => kernel === state.selected, listener => {
    notify = listener; listener({ kind: 'ready', kernelId: 'local' }); return async () => {};
  });
  return { state, registered, policies, errors, calls, sources, notify: event => notify({ kernelId: 'local', ...event }) };
}

test('one snapshot discovers thousands of rules across documents; refresh reflects edits, additions and deletions', async () => {
  const rows = Array.from({ length: 2000 }, (_, index) => ({ ...block, id: `20251211093951-${String(index).padStart(7, '0')}`, root_id: index % 2 ? 'doc-a' : 'doc-b' }));
  const f = fixture([...rows, { ...block, subtype: 'DSH-OTHER' }, { ...block, subtype: 'TIP' }]);
  try {
    await f.sources.refresh();
    const catalog = () => f.registered.get('siyuan:local:reminders');
    assert.equal(catalog().rules.length, 2000); assert.equal(f.calls.length, 1);
    assert.equal(f.state.writes, 1);
    await f.sources.refresh(); assert.equal(f.state.writes, 1);
    f.state.rows = [{ ...rows[0], markdown: markdown.replace('禁止使用 any。', '更新的正文。') }, block];
    await f.sources.refresh();
    assert.equal(catalog().rules.length, 2); assert.equal(catalog().rules[0].text, '更新的正文。');
    assert.equal(catalog().rules[0].id, `${rows[0].id}:no-any`);
    f.state.rows = []; await f.sources.refresh(); assert.equal(catalog().rules.length, 0);
    assert.deepEqual(f.errors, []);
  } finally { await f.sources.dispose(); }
  assert.equal(f.registered.size, 0);
});

test('a malformed owned block keeps valid siblings; disconnect and disabled cores withdraw sources', async () => {
  const f = fixture([block, { ...block, id: '20251211093952-abcdefg', markdown: '> [!DSH-REMINDER] incomplete' }]);
  try {
    await f.sources.refresh();
    assert.equal(f.registered.get('siyuan:local:reminders').rules.length, 1);
    assert.match(f.errors[0], /20251211093952-abcdefg/);
    assert.equal(f.policies.get('siyuan:local:reminders').acceptSession('session'), true);
    f.state.selected = 'another';
    assert.equal(f.policies.get('siyuan:local:reminders').acceptSession('session'), false);
    f.state.offline = true; await f.sources.refresh(); assert.equal(f.registered.size, 0);
    f.state.offline = false; await f.sources.refresh(); assert.equal(f.registered.size, 1);
    f.state.kernels = []; await f.sources.refresh(); assert.equal(f.registered.size, 0);
  } finally { await f.sources.dispose(); }
});

test('service capacity refusal retains accepted rules and retries growth after the limit changes', async () => {
  const f = fixture([block]);
  try {
    await f.sources.refresh(); assert.equal(f.registered.size, 1);
    f.state.cap = 1; f.state.rows.push({ ...block, id: '20251211093952-abcdefg' });
    await f.sources.refresh(); assert.equal(f.registered.get('siyuan:local:reminders').rules.length, 1);
    assert.match(f.errors[0], /capacity/);
    f.state.cap = 0; await f.sources.refresh();
    assert.equal(f.registered.get('siyuan:local:reminders').rules.length, 2);
  } finally { await f.sources.dispose(); }
});

const settle = async (condition, timeout = 5000) => {
  const until = Date.now() + timeout;
  while (!condition() && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(condition(), 'event batch did not settle');
};

test('idle time does no SQL; root changes merge additions and deletions and reuse validation', async () => {
  const secondRoot = '20251211093949-abcdefg';
  const f = fixture([block], { refreshMs: 1000 });
  try {
    await f.sources.refresh();
    assert.equal(f.state.validations, 1);
    await new Promise(resolve => setTimeout(resolve, 1100));
    assert.equal(f.calls.length, 1);
    f.notify({ kind: 'change', roots: [secondRoot] });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(f.calls.length, 1);
    // One burst on a known document becomes one partial query, even if the edited child is not a rule.
    for (let i = 0; i < 10; i++) f.notify({ kind: 'change', roots: [block.root_id] });
    await settle(() => f.calls.length === 2);
    assert.deepEqual(f.calls[1].roots, [block.root_id]);
    assert.equal(f.state.validations, 1);
    assert.equal(f.state.writes, 1);
    const added = { ...block, id: '20251211093952-abcdefg', root_id: secondRoot };
    f.state.rows.push(added); f.notify({ kind: 'change', roots: [secondRoot], marker: true });
    await settle(() => f.registered.get('siyuan:local:reminders').rules.length === 2);
    f.state.rows = [added]; f.notify({ kind: 'change', roots: [block.root_id] });
    await settle(() => f.registered.get('siyuan:local:reminders').rules.length === 1);
    assert.equal(f.registered.get('siyuan:local:reminders').rules[0].id, added.id + ':no-any');
  } finally { await f.sources.dispose(); }
});

test('events during a scan survive the batch; offline withdraws immediately and reconnect fully reconciles', async () => {
  const f = fixture([block]);
  try {
    await f.sources.refresh();
    let entered, release;
    const started = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    f.state.gate = async () => { entered(); await gate; };
    f.notify({ kind: 'change', roots: [block.root_id] });
    await started;
    f.notify({ kind: 'change', roots: [block.root_id] });
    release();
    await settle(() => f.calls.length === 3);
    f.notify({ kind: 'offline' }); assert.equal(f.registered.size, 0);
    f.state.rows = [{ ...block, markdown: markdown.replace('禁止使用 any。', '重连正文。') }];
    f.notify({ kind: 'ready' });
    await settle(() => f.registered.size === 1);
    assert.equal(f.calls.at(-1).roots, undefined);
    assert.equal(f.registered.get('siyuan:local:reminders').rules[0].text, '重连正文。');
  } finally { await f.sources.dispose(); }
});

test('capacity retry uses cached candidates without repeating SQL or validation', async () => {
  const f = fixture([block], { refreshMs: 1000 });
  try {
    await f.sources.refresh(); f.state.cap = 1;
    f.state.rows.push({ ...block, id: '20251211093952-abcdefg' });
    await f.sources.refresh();
    const calls = f.calls.length, validations = f.state.validations;
    f.state.cap = 0;
    await settle(() => f.registered.get('siyuan:local:reminders').rules.length === 2);
    assert.equal(f.calls.length, calls); assert.equal(f.state.validations, validations);
  } finally { await f.sources.dispose(); }
});

test('initial snapshot retains unmarked root events and an offline scan cannot restore an old source', async () => {
  const f = fixture([block]);
  try {
    let entered, release;
    const started = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    f.state.gate = async () => { entered(); await gate; };
    const initial = f.sources.refresh(); await started;
    f.notify({ kind: 'change', roots: [block.root_id] });
    release(); await initial;
    assert.equal(f.calls.length, 2);
    assert.deepEqual(f.calls[1].roots, [block.root_id]);
    let enterAgain, releaseAgain;
    const again = new Promise(resolve => { enterAgain = resolve; });
    const pause = new Promise(resolve => { releaseAgain = resolve; });
    f.state.gate = async () => { enterAgain(); await pause; };
    const scanning = f.sources.refresh(); await again;
    f.notify({ kind: 'offline' }); releaseAgain(); await scanning;
    assert.equal(f.registered.size, 0);
  } finally { await f.sources.dispose(); }
});

test('unchanged invalid declarations reuse cached validation errors', async () => {
  const f = fixture([{ ...block, id: '20251211093952-abcdefg', markdown: '> [!DSH-REMINDER] incomplete' },
    { ...block, id: '20251211093953-abcdefg', markdown: markdown.replace('禁止使用 any。', '校验拒绝。') }, block]);
  try {
    await f.sources.refresh();
    const validations = f.state.validations, writes = f.state.writes;
    await f.sources.refresh();
    assert.equal(f.state.validations, validations); assert.equal(f.state.writes, writes);
  } finally { await f.sources.dispose(); }
});
