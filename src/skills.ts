/**
 * 思源技能来源：带 agent-skill 标签的文档即技能。
 *
 * 文档首个子块是 YAML frontmatter（name / description / whenToUse），其余是正文。
 * 发现一条 SQL，加载一次导出；失效由宿主推送驱动，本模块不做定时查询。
 */
import type { SkillCandidate, SkillDefinition, SkillLookupOptions, SkillProvider } from "@deepseek-ai/dsh-skill";
import { textOf, type KernelPush } from "./push.js";

/** 提供方名；runtime 是注册表保留的名字，不能用。 */
export const PROVIDER = "siyuan";
/** 思源是作者改技能的地方，改起来最方便，所以排在所有来源之前——rank 小的赢。 */
const RANK = 0;
/** 文档属性里存的是不带井号的标签名，SQL 索引里是带井号的 #agent-skill#。 */
export const TAG = "agent-skill";
/** 技能名格式由注册表校验；本地先筛一遍，别让一条坏数据拖垮整个来源。 */
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** 摘要一层：发现阶段只读这些，不读正文。 */
export interface SkillDocument {
  readonly id: string;
  /** 文档标题，只用于诊断。 */
  readonly title: string;
  /** 首个文档子块的原始 YAML 文本。 */
  readonly frontmatter: string;
}

/** 一篇技能的同级资料：正文里的相对路径靠它落到具体块。 */
export interface SkillAttachment {
  /** 相对技能文档父目录的路径。 */
  readonly path: string;
  readonly id: string;
}

/** 加载一层：正文与它引用的同级文档。 */
export interface SkillBody {
  readonly markdown: string;
  /** 技能文档自己的 hpath，用于拼资源说明。 */
  readonly hpath: string;
  readonly attachments: readonly SkillAttachment[];
}

/** 宿主侧读取端口：SQL 与导出参数由实现写死，调用方不能提交任意查询。 */
export interface SkillSource {
  /** 技能只来自一个核心；返回 undefined 表示当前没有可用核心。 */
  kernel(): string | undefined;
  documents(kernelId: string, signal?: AbortSignal): Promise<readonly SkillDocument[]>;
  body(kernelId: string, docId: string, signal?: AbortSignal): Promise<SkillBody>;
}

/** 去掉成对引号；frontmatter 里带冒号的值通常会被作者加引号。 */
function unquote(value: string): string {
  const text = value.trim();
  if (text.length >= 2 && (text.startsWith('"') || text.startsWith("'")) && text.endsWith(text[0])) return text.slice(1, -1);
  return text;
}

/**
 * 解析首个子块的 YAML。
 *
 * 只认单行 key: value，以及缩进续行。块标量（| 和 >）会让描述变成多行，
 * 这里的拼法会产生与作者预期不同的文本，所以直接报错而不是猜。
 */
export function frontmatter(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  let key: string | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const pair = /^([A-Za-z][\w-]*):[ \t]*(.*)$/.exec(line);
    if (pair) {
      const value = pair[2].trim();
      if (value === "|" || value === ">") throw new Error(`技能 frontmatter 的 ${pair[1]} 用了块标量，暂不支持`);
      key = pair[1];
      result[key] = unquote(value);
      continue;
    }
    if (key) { result[key] = `${result[key]} ${line}`.trim(); continue; }
    throw new Error(`技能 frontmatter 无法解析：${line}`);
  }
  return result;
}

/** 导出结果开头是 frontmatter 代码块；name/description 已作为元数据给了，正文不该重复。 */
export function stripFrontmatter(markdown: string): string {
  const text = markdown.replace(/^\s+/, "");
  const block = /^```[A-Za-z]*[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*(?:\r?\n|$)/.exec(text);
  if (!block || !/^name[ \t]*:/m.test(block[1])) return text;
  return text.slice(block[0].length).replace(/^\s+/, "");
}

/** 正文写的是同目录下的相对路径，模型不知道相对谁，所以在末尾补一份带块 ID 的清单。 */
function attachmentSection(list: readonly SkillAttachment[]): string {
  if (!list.length) return "";
  return ["", "## 附件（思源文档）", "", ...list.map(item => `- ${item.path} → ${item.id}`), ""].join("\n");
}

interface Locator {
  readonly kernelId: string;
  readonly docId: string;
}

function isLocator(value: unknown): value is Locator {
  return value !== null && typeof value === "object"
    && typeof (value as Record<string, unknown>).kernelId === "string"
    && typeof (value as Record<string, unknown>).docId === "string";
}

/** 思源侧技能提供方。发现结果里记下的文档 ID 用来判断一次推送是否动到了技能。 */
export class SiYuanSkills implements SkillProvider {
  readonly name = PROVIDER;
  /** 上一次发现到的技能文档；推送命中这些 ID 说明正文或结构变了。 */
  #known = new Set<string>();
  constructor(private readonly source: SkillSource) {}

  async list(options: SkillLookupOptions): Promise<SkillCandidate[]> {
    const kernelId = this.source.kernel();
    if (kernelId === undefined) return [];
    const documents = await this.source.documents(kernelId, options.signal);
    const known = new Set<string>();
    const candidates: SkillCandidate[] = [];
    for (const document of documents) {
      // 注册表会因为一条坏候选跳过整个提供方，所以这里逐条筛：坏的不要，好的照给。
      let head: Record<string, string>;
      try { head = frontmatter(document.frontmatter); } catch { continue; }
      const name = unquote(head.name ?? "");
      const description = unquote(head.description ?? "");
      if (!NAME.test(name) || !description) continue;
      known.add(document.id);
      const whenToUse = unquote(head.whenToUse ?? "");
      candidates.push({
        name,
        description,
        ...(whenToUse ? { whenToUse } : {}),
        invocation: { modelInvocable: true, userInvocable: true },
        source: "custom",
        provider: PROVIDER,
        rank: RANK,
        locator: { kernelId, docId: document.id } satisfies Locator,
      });
    }
    this.#known = known;
    return candidates;
  }

  async get(candidate: SkillCandidate, options: SkillLookupOptions): Promise<SkillDefinition | undefined> {
    const locator = candidate.locator;
    if (!isLocator(locator)) return undefined;
    const body = await this.source.body(locator.kernelId, locator.docId, options.signal);
    const directory = body.hpath.replace(/\/[^/]*$/, "");
    return {
      name: candidate.name,
      description: candidate.description,
      ...(candidate.whenToUse === undefined ? {} : { whenToUse: candidate.whenToUse }),
      invocation: candidate.invocation,
      source: candidate.source,
      provider: PROVIDER,
      // 模型读到技能时应该知道它从哪来、该改哪：改思源文档，别去文件系统找。
      resourceBase: {
        kind: "opaque",
        description: `本技能存放在思源笔记 ${directory}/，主文档 ${locator.docId}。`
          + `要改技能内容就改那份思源文档（siyuan_query 读、siyuan_update 改），不要改文件系统。`
          + `同级附件见正文末尾的清单。`,
      },
      content: stripFrontmatter(body.markdown) + attachmentSection(body.attachments),
    };
  }

  /**
   * 推送到达时判断技能集是否可能变化；返回 true 说明该让注册表重新发现。
   *
   * 三层都只是「可能变了」的判断，不做任何查询：没有可靠范围的事务按全量处理；
   * 命中已知技能文档就是它自己被改了；不认识的文档里出现标签文本，说明刚被打上标签。
   */
  observe(event: KernelPush): boolean {
    if (event.kind !== "change") return false;
    if (event.roots === undefined) return true;
    if (event.roots.some(id => this.#known.has(id))) return true;
    return event.operations.some(operation => textOf(operation.data).includes(TAG));
  }
}
