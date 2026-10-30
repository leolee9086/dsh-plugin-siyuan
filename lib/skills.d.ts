/**
 * 思源技能来源：带 agent-skill 标签的文档即技能。
 *
 * 文档首个子块是 YAML frontmatter（name / description / whenToUse），其余是正文。
 * 发现一条 SQL，加载一次导出；失效由宿主推送驱动，本模块不做定时查询。
 */
import type { SkillCandidate, SkillDefinition, SkillLookupOptions, SkillProvider } from "@deepseek-ai/dsh-skill";
import { type KernelPush } from "./push.js";
/** 提供方名；runtime 是注册表保留的名字，不能用。 */
export declare const PROVIDER = "siyuan";
/** 文档属性里存的是不带井号的标签名，SQL 索引里是带井号的 #agent-skill#。 */
export declare const TAG = "agent-skill";
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
/**
 * 解析首个子块的 YAML。
 *
 * 只认单行 key: value，以及缩进续行。块标量（| 和 >）会让描述变成多行，
 * 这里的拼法会产生与作者预期不同的文本，所以直接报错而不是猜。
 */
export declare function frontmatter(text: string): Record<string, string>;
/** 导出结果开头是 frontmatter 代码块；name/description 已作为元数据给了，正文不该重复。 */
export declare function stripFrontmatter(markdown: string): string;
/** 思源侧技能提供方。发现结果里记下的文档 ID 用来判断一次推送是否动到了技能。 */
export declare class SiYuanSkills implements SkillProvider {
    #private;
    private readonly source;
    readonly name = "siyuan";
    constructor(source: SkillSource);
    list(options: SkillLookupOptions): Promise<SkillCandidate[]>;
    get(candidate: SkillCandidate, options: SkillLookupOptions): Promise<SkillDefinition | undefined>;
    /**
     * 推送到达时判断技能集是否可能变化；返回 true 说明该让注册表重新发现。
     *
     * 三层都只是「可能变了」的判断，不做任何查询：没有可靠范围的事务按全量处理；
     * 命中已知技能文档就是它自己被改了；不认识的文档里出现标签文本，说明刚被打上标签。
     */
    observe(event: KernelPush): boolean;
}
