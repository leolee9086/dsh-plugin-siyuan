/** 思源桌面内核的 PID→port 登记文件。只读发现，不扫描端口、不读取凭据、不重放业务调用。 */
import { readFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import path from "node:path";
import type { ApiConfig } from "./api.js";

export interface KernelInstance { pid: number; port: number; apiUrl: string; version: string }
export class DiscoveryError extends Error {
  constructor(message: string, readonly instances: KernelInstance[] = [], options?: ErrorOptions) {
    super(message, options);
    this.name = "DiscoveryError";
  }
}

/** util.HomeDir 使用 gulu.OS.Home()，先取账户 Home，而不是平台的应用数据目录。 */
export function defaultPortFile(platform = process.platform, home?: string): string {
  // 移动端需要主动配置 apiUrl；此处只处理 DSH 现有的桌面运行环境。
  if (!["win32", "darwin", "linux"].includes(platform)) {
    throw new DiscoveryError(`平台 ${platform} 无可用的桌面端口文件规则，请配置 apiUrl 或 portFile`);
  }
  if (home === undefined) {
    try { home = userInfo().homedir; }
    catch {
      // 对应 gulu 在无法获得账户信息时的环境回退，普通桌面安装走上面的账户路径。
      home = platform === "win32" && process.env.HOMEDRIVE && process.env.HOMEPATH
        ? process.env.HOMEDRIVE + process.env.HOMEPATH : homedir();
    }
  }
  return (platform === "win32" ? path.win32 : path.posix).join(home, ".config", "siyuan", "port.json");
}

function running(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    if ((error as NodeJS.ErrnoException).code === "EPERM") return true;
    throw error;
  }
}

async function probe(pid: number, port: number, signal?: AbortSignal): Promise<KernelInstance | undefined> {
  const apiUrl = `http://127.0.0.1:${port}`;
  const bounded = AbortSignal.any([AbortSignal.timeout(1500), ...(signal ? [signal] : [])]);
  try {
    // router.go 的版本路由不要求鉴权。先确认服务形状，配置 token 不参与候选探针。
    const response = await fetch(`${apiUrl}/api/system/version`, { signal: bounded, redirect: "manual" });
    if (!response.ok) { await response.body?.cancel(); return; }
    const reader = response.body?.getReader();
    if (!reader) return;
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 65536) { await reader.cancel(); return; }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (result?.code === 0 && typeof result.msg === "string" && typeof result.data === "string"
      && /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(result.data) && running(pid)) {
      return { pid, port, apiUrl, version: result.data };
    }
  } catch {
    // 失效端口和非思源服务只是候选淘汰；整次发现的取消须继续报告给调用方。
    signal?.throwIfAborted();
  }
  return undefined;
}

export class KernelDiscovery {
  private selectedPid?: number;
  constructor(readonly config: ApiConfig) { this.selectedPid = config.kernelPid; }

  get portFile(): string { return this.config.portFile ?? defaultPortFile(); }

  async discover(signal?: AbortSignal): Promise<KernelInstance[]> {
    signal?.throwIfAborted();
    let document: unknown;
    try {
      const bytes = await readFile(this.portFile, { signal });
      if (bytes.length > 1024 * 1024) throw new Error("端口文件超过1MiB");
      document = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
    } catch (error) {
      signal?.throwIfAborted();
      throw new DiscoveryError(`无法读取思源端口文件 ${this.portFile}；请启动同一账户下的思源，或配置 portFile/apiUrl`, [], { cause: error });
    }
    if (!document || typeof document !== "object" || Array.isArray(document)) {
      throw new DiscoveryError(`思源端口文件 ${this.portFile} 必须为 PID→端口对象`);
    }
    const candidates: { pid: number; port: number }[] = [];
    for (const [key, value] of Object.entries(document)) {
      if (!/^[1-9]\d*$/.test(key) || !/^[1-9]\d*$/.test(String(value)) || !["string", "number"].includes(typeof value)) continue;
      const pid = Number(key), port = Number(value);
      if (!Number.isSafeInteger(pid) || pid > 2147483647 || port > 65535 || !running(pid)) continue;
      candidates.push({ pid, port });
    }
    if (candidates.length > 64) throw new DiscoveryError("思源端口文件含超过64个存活PID，请检查文件或配置明确的 apiUrl");
    const instances: KernelInstance[] = [];
    // 分批限制探针并发，文件里大量退出残留不会产生网络扫描。
    for (let offset = 0; offset < candidates.length; offset += 8) {
      signal?.throwIfAborted();
      const results = await Promise.all(candidates.slice(offset, offset + 8).map(({ pid, port }) => probe(pid, port, signal)));
      instances.push(...results.filter((value): value is KernelInstance => value !== undefined));
    }
    signal?.throwIfAborted();
    return instances.sort((a, b) => a.pid - b.pid);
  }

  async status(signal?: AbortSignal) {
    if (this.config.apiUrl !== "auto") return { mode: "explicit", apiUrl: this.config.apiUrl };
    return { mode: "auto", portFile: this.portFile, selectedPid: this.selectedPid ?? null, instances: await this.discover(signal) };
  }

  async select(pid: number, signal?: AbortSignal): Promise<KernelInstance> {
    if (this.config.apiUrl !== "auto") throw new DiscoveryError("显式 apiUrl 模式不使用 PID 选择");
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new DiscoveryError("pid 必须为正整数");
    const instances = await this.discover(signal);
    const instance = instances.find(item => item.pid === pid);
    if (!instance) throw new DiscoveryError(`PID ${pid} 不是当前有效的思源实例`, instances);
    this.selectedPid = pid;
    return instance;
  }

  async resolve(signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    if (this.config.apiUrl !== "auto") return this.config.apiUrl;
    const instances = await this.discover(signal);
    if (this.selectedPid !== undefined) {
      const selected = instances.find(item => item.pid === this.selectedPid);
      if (selected) return selected.apiUrl;
      throw new DiscoveryError(`选择的思源 PID ${this.selectedPid} 已不可用；用 siyuan_rpc connection/status 与 connection/select 重新选择`, instances);
    }
    if (instances.length === 1) return instances[0]!.apiUrl;
    if (instances.length === 0) throw new DiscoveryError(`端口文件 ${this.portFile} 中没有可连接的思源实例，请确认思源已启动`);
    throw new DiscoveryError(`发现多个思源实例：${instances.map(item => `PID ${item.pid} ${item.apiUrl}`).join("；")}。请用 siyuan_rpc connection/select 指定 pid，或配置 kernelPid/apiUrl`, instances);
  }
}
