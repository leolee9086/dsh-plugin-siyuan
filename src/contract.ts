/** 内核生成的请求契约；路由器负责匹配，Ajv 负责校验，不建立第二套路径索引。 */
import { readFileSync } from "node:fs";
import { createRouter, type Router, type RouterContext } from "@leolee9086/sac-path-router";
import Ajv2020 from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";

export interface EndpointSpec {
  method: string;
  path: string;
  body: string;
  handler: string;
  output: string | null;
  request: unknown;
}
export interface ContractFile {
  siyuanVersion: string;
  endpointCount: number;
  endpoints: EndpointSpec[];
  $defs: Record<string, unknown>;
}

export class ContractError extends Error {
  constructor(readonly spec: EndpointSpec, readonly problems: string[]) {
    super(`${spec.method} ${spec.path} 参数不符合契约：${problems.join("；")}`);
    this.name = "ContractError";
  }
}

export class Contract {
  readonly version: string;
  readonly endpoints: EndpointSpec[];
  private readonly defs: Record<string, unknown>;
  private readonly ajv: InstanceType<typeof Ajv2020>;
  private readonly validators = new WeakMap<EndpointSpec, ValidateFunction>();

  constructor(file: ContractFile) {
    this.version = file.siyuanVersion;
    this.endpoints = file.endpoints;
    this.defs = file.$defs;
    this.ajv = new Ajv2020({ strict: false, allErrors: true });
    this.ajv.addFormat("binary", true);
    // 单份文档拥有全部 $defs，保留原生 JSON Pointer，避免手工改写引用。
    this.ajv.addSchema({ $id: "urn:siyuan:contract", $defs: file.$defs, endpoints: file.endpoints });
  }

  /** Gin 的 *name 是带名字的剩余路径；转换成路由库的命名重复参数。 */
  router<C extends RouterContext>(handler: (ctx: C, spec: EndpointSpec) => Promise<void>): Router<C> {
    const router = createRouter<C>({ sensitive: true, strict: true, matcher: "regexp" });
    for (const spec of this.endpoints) {
      const path = spec.path.replace(/\*([A-Za-z0-9_]+)/g, ":$1(.*)");
      router.register(path, [spec.method], (ctx, next) => ctx.method === spec.method ? handler(ctx, spec) : next(),
        { name: `${spec.method} ${spec.path}` });
    }
    return router;
  }

  check(spec: EndpointSpec, payload: unknown): void {
    if (spec.request === null || spec.request === undefined) return;
    let validate = this.validators.get(spec);
    if (!validate) {
      // Schema 的本地引用由同一文档解析；每条端点只编译一次。
      validate = this.ajv.compile({ $ref: `urn:siyuan:contract#/endpoints/${this.endpoints.indexOf(spec)}/request` });
      this.validators.set(spec, validate);
    }
    if (!validate(payload)) {
      throw new ContractError(spec, (validate.errors ?? []).map(e =>
        `${e.instancePath || "/"} ${e.message} ${JSON.stringify(e.params)}`));
    }
  }

  /** 返回端点请求 Schema 的引用闭包，调用方可以直接交给 JSON Schema 校验库。 */
  requestSchema(spec: EndpointSpec): unknown {
    const defs: Record<string, unknown> = {};
    const visit = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) { node.forEach(visit); return; }
      const ref = (node as Record<string, unknown>).$ref;
      if (typeof ref === "string" && ref.startsWith("#/$defs/")) {
        const name = ref.slice(8);
        if (!(name in defs)) {
          if (!(name in this.defs)) throw new Error(`缺少契约定义 ${name}`);
          defs[name] = this.defs[name];
          visit(defs[name]);
        }
      }
      Object.values(node).forEach(visit);
    };
    visit(spec.request);
    return { ...(spec.request as object), $defs: defs };
  }
}

export function loadContract(): Contract {
  return new Contract(JSON.parse(readFileSync(new URL("./generated/contract.json", import.meta.url), "utf8")));
}
