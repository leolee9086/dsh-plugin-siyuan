import test from 'node:test';
import assert from 'node:assert/strict';
import { SiYuanSkills, frontmatter, stripFrontmatter, PROVIDER } from '../../lib/skills.js';

/** 假数据构造：只提供端口要求的形状，不模拟 DSH 上下文。 */
function skills(documents, body) {
  const source = {
    kernel: () => 'local',
    documents: async () => documents,
    body: async () => body,
  };
  return new SiYuanSkills(source);
}

const document = (id, text) => ({ id, title: 'SKILL', frontmatter: text });
const body = (markdown, attachments = [], hpath = '/n/skills/demo/SKILL') => ({ markdown, hpath, attachments });

test('frontmatter 解析单行键值与引号', () => {
  const parsed = frontmatter('name: demo-skill\ndescription: "带冒号: 的描述"\nwhenToUse: 当用户写插件时');
  assert.equal(parsed.name, 'demo-skill');
  assert.equal(parsed.description, '带冒号: 的描述');
  assert.equal(parsed.whenToUse, '当用户写插件时');
});

test('frontmatter 支持缩进续行，遇到块标量和无主行直接报错', () => {
  assert.equal(frontmatter('description: 第一段\n  第二段').description, '第一段 第二段');
  assert.throws(() => frontmatter('description: |'), /块标量/);
  assert.throws(() => frontmatter('没有键的一行'), /无法解析/);
});

test('stripFrontmatter 只在首个代码块确实是 frontmatter 时剪掉', () => {
  assert.equal(stripFrontmatter('```yaml\nname: demo\ndescription: d\n```\n\n正文'), '正文');
  assert.equal(stripFrontmatter('```js\nconsole.log(1)\n```\n正文'), '```js\nconsole.log(1)\n```\n正文');
  assert.equal(stripFrontmatter('正文'), '正文');
});

test('list 只收名字合法且描述非空的文档', async () => {
  const provider = skills([
    document('20261030143115-aaaaaaa', 'name: good-skill\ndescription: 可用'),
    document('20261030143115-bbbbbbb', 'name: Bad Name\ndescription: 名字不合法'),
    document('20261030143115-ccccccc', 'name: no-description'),
    document('20261030143115-ddddddd', '这不是 frontmatter'),
  ], body(''));
  const candidates = await provider.list({});
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].name, 'good-skill');
  assert.equal(candidates[0].provider, PROVIDER);
  assert.equal(candidates[0].rank, 0);
  assert.deepEqual(candidates[0].locator, { kernelId: 'local', docId: '20261030143115-aaaaaaa' });
});

test('get 剪掉 frontmatter 并补上附件清单', async () => {
  const provider = skills([], body('```yaml\nname: good-skill\ndescription: 可用\n```\n\n# 正文\n看 规程/自查.spec.md',
    [{ path: '规程/自查.spec.md', id: '20261030143115-eeeeeee' }]));
  const candidate = { name: 'good-skill', description: '可用', invocation: { modelInvocable: true, userInvocable: true },
    source: 'custom', provider: PROVIDER, rank: 0, locator: { kernelId: 'local', docId: '20261030143115-aaaaaaa' } };
  const loaded = await provider.get(candidate, {});
  assert.ok(loaded.content.startsWith('# 正文'));
  assert.ok(!loaded.content.includes('name: good-skill'));
  assert.ok(loaded.content.includes('规程/自查.spec.md → 20261030143115-eeeeeee'));
  assert.equal(loaded.resourceBase.kind, 'opaque');
});

test('observe 只在技能集可能变化时返回 true', async () => {
  const provider = skills([document('20261030143115-aaaaaaa', 'name: good-skill\ndescription: 可用')], body(''));
  await provider.list({});
  // 没有可靠范围的事务按全量处理
  assert.equal(provider.observe({ kernelId: 'local', kind: 'change', operations: [] }), true);
  // 命中已知技能文档
  assert.equal(provider.observe({ kernelId: 'local', kind: 'change', roots: ['20261030143115-aaaaaaa'], operations: [] }), true);
  // 不认识的文档里出现标签文本：刚被打上技能标签
  assert.equal(provider.observe({ kernelId: 'local', kind: 'change', roots: ['20261030143115-fffffff'],
    operations: [{ action: 'updateAttrs', data: { new: { tags: 'agent-skill' } } }] }), true);
  // 无关编辑
  assert.equal(provider.observe({ kernelId: 'local', kind: 'change', roots: ['20261030143115-fffffff'],
    operations: [{ action: 'update', data: '普通文本' }] }), false);
  // 非变更事件
  assert.equal(provider.observe({ kernelId: 'local', kind: 'ready' }), false);
});
