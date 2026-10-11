import type { ApiConfig } from "./api.js";
export interface KernelInstance {
    pid: number;
    port: number;
    apiUrl: string;
    version: string;
}
export declare class DiscoveryError extends Error {
    readonly instances: KernelInstance[];
    constructor(message: string, instances?: KernelInstance[], options?: ErrorOptions);
}
/** util.HomeDir 使用 gulu.OS.Home()，先取账户 Home，而不是平台的应用数据目录。 */
export declare function defaultPortFile(platform?: NodeJS.Platform, home?: string): string;
export declare class KernelDiscovery {
    readonly config: ApiConfig;
    private selectedPid?;
    constructor(config: ApiConfig);
    get portFile(): string;
    discover(signal?: AbortSignal): Promise<KernelInstance[]>;
    status(signal?: AbortSignal): Promise<{
        mode: string;
        apiUrl: string;
        portFile?: undefined;
        selectedPid?: undefined;
        instances?: undefined;
    } | {
        mode: string;
        portFile: string;
        selectedPid: number | null;
        instances: KernelInstance[];
        apiUrl?: undefined;
    }>;
    select(pid: number, signal?: AbortSignal): Promise<KernelInstance>;
    resolve(signal?: AbortSignal): Promise<string>;
}
