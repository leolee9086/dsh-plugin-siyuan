import { textOf } from "./push.js";
/** 提供方名；runtime 是注册表保留的名字，不能用。 */
export const PROVIDER = "siyuan";
/** 思源是作者改技能的地方，改起来最方便，所以排在所有来源之前——rank 小的赢。 */
const RANK = 0;
/** 文档属性里存的是不带井号的标签名，SQL 索引里是带井号的 #agent-skill#。 */
export const TAG = "agent-skill";
/** 技能名格式由注册表校验；本地先筛一遍，别让一条坏数据拖垮整个来源。 */
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** 去掉成对引号；frontmatter 里带冒号的值通常会被作者加引号。 */
function unquote(value) {
    const text = value.trim();
    if (text.length >= 2 && (text.startsWith('"') || text.startsWith("'")) && text.endsWith(text[0]))
        return text.slice(1, -1);
    return text;
}
/**
 * 解析首个子块的 YAML。
 *
 * 只认单行 key: value，以及缩进续行。块标量（| 和 >）会让描述变成多行，
 * 这里的拼法会产生与作者预期不同的文本，所以直接报错而不是猜。
 */
export function frontmatter(text) {
    const result = {};
    let key;
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith("#"))
            continue;
        const pair = /^([A-Za-z][\w-]*):[ \t]*(.*)$/.exec(line);
        if (pair) {
            const value = pair[2].trim();
            if (value === "|" || value === ">")
                throw new Error(`技能 frontmatter 的 ${pair[1]} 用了块标量，暂不支持`);
            key = pair[1];
            result[key] = unquote(value);
            continue;
        }
        if (key) {
            result[key] = `${result[key]} ${line}`.trim();
            continue;
        }
        throw new Error(`技能 frontmatter 无法解析：${line}`);
    }
    return result;
}
/** 导出结果开头是 frontmatter 代码块；name/description 已作为元数据给了，正文不该重复。 */
export function stripFrontmatter(markdown) {
    const text = markdown.replace(/^\s+/, "");
    const block = /^```[A-Za-z]*[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*(?:\r?\n|$)/.exec(text);
    if (!block || !/^name[ \t]*:/m.test(block[1]))
        return text;
    return text.slice(block[0].length).replace(/^\s+/, "");
}
/** 正文写的是同目录下的相对路径，模型不知道相对谁，所以在末尾补一份带块 ID 的清单。 */
function attachmentSection(list) {
    if (!list.length)
        return "";
    return ["", "## 附件（思源文档）", "", ...list.map(item => `- ${item.path} → ${item.id}`), ""].join("\n");
}
function isLocator(value) {
    return value !== null && typeof value === "object"
        && typeof value.kernelId === "string"
        && typeof value.docId === "string";
}
/** 思源侧技能提供方。发现结果里记下的文档 ID 用来判断一次推送是否动到了技能。 */
export class SiYuanSkills {
    source;
    name = PROVIDER;
    /** 上一次发现到的技能文档；推送命中这些 ID 说明正文或结构变了。 */
    #known = new Set();
    constructor(source) {
        this.source = source;
    }
    async list(options) {
        const kernelId = this.source.kernel();
        if (kernelId === undefined)
            return [];
        const documents = await this.source.documents(kernelId, options.signal);
        const known = new Set();
        const candidates = [];
        for (const document of documents) {
            // 注册表会因为一条坏候选跳过整个提供方，所以这里逐条筛：坏的不要，好的照给。
            let head;
            try {
                head = frontmatter(document.frontmatter);
            }
            catch {
                continue;
            }
            const name = unquote(head.name ?? "");
            const description = unquote(head.description ?? "");
            if (!NAME.test(name) || !description)
                continue;
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
                locator: { kernelId, docId: document.id },
            });
        }
        this.#known = known;
        return candidates;
    }
    async get(candidate, options) {
        const locator = candidate.locator;
        if (!isLocator(locator))
            return undefined;
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
    observe(event) {
        if (event.kind !== "change")
            return false;
        if (event.roots === undefined)
            return true;
        if (event.roots.some(id => this.#known.has(id)))
            return true;
        return event.operations.some(operation => textOf(operation.data).includes(TAG));
    }
}
