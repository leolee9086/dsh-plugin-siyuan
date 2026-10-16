import { setTimeout as delay } from 'node:timers/promises';
const transientCodes = new Set(['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'EAI_AGAIN', 'ETIMEDOUT',
    'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT']);
const descriptions = {
    ECONNRESET: '远端或代理重置了连接', ECONNREFUSED: '核心拒绝连接，请检查服务是否启动和端口配置',
    EPIPE: '远端连接已关闭', EAI_AGAIN: 'DNS 暂时不可用', ENOTFOUND: '无法解析核心主机名',
    ETIMEDOUT: '网络连接超时', UND_ERR_SOCKET: '远端连接已关闭',
    UND_ERR_CONNECT_TIMEOUT: '建立连接超时', UND_ERR_HEADERS_TIMEOUT: '等待响应头超时',
    CERT_HAS_EXPIRED: 'HTTPS 证书已过期', DEPTH_ZERO_SELF_SIGNED_CERT: 'HTTPS 证书不受信任',
};
function errorCode(error, depth = 0) {
    if (depth > 5 || !error || typeof error !== 'object')
        return;
    if ('code' in error && typeof error.code === 'string')
        return error.code;
    if ('cause' in error)
        return errorCode(error.cause, depth + 1);
    if (error instanceof AggregateError) {
        for (const child of error.errors) {
            const code = errorCode(child, depth + 1);
            if (code)
                return code;
        }
    }
}
function retryDelay(response) {
    const header = response.headers.get('retry-after');
    if (!header)
        return 150;
    const seconds = /^\d+$/.test(header) ? Number(header) : (Date.parse(header) - Date.now()) / 1000;
    // 长等待由下一次主动调用处理，本次请求仍受原始总超时限制。
    return Number.isFinite(seconds) && seconds <= 1 ? Math.max(0, seconds * 1000) : undefined;
}
/** 只为无请求体的 GET/HEAD 重试一次；同一 URL、凭据和截止信号贯穿两次尝试。 */
export async function sendRequest(request) {
    const retryable = ['GET', 'HEAD'].includes(request.method) && request.body === null;
    for (let attempt = 0;; attempt++) {
        request.signal.throwIfAborted();
        try {
            const response = await globalThis.fetch(request);
            if (retryable && attempt === 0 && [502, 503, 504].includes(response.status)) {
                const wait = retryDelay(response);
                if (wait !== undefined) {
                    await response.body?.cancel();
                    await delay(wait, undefined, { signal: request.signal });
                    continue;
                }
            }
            // 响应体一旦交给消费者便不重放，流中断仍由本次调用结算。
            return response;
        }
        catch (error) {
            request.signal.throwIfAborted();
            const code = errorCode(error);
            if (retryable && attempt === 0 && code && transientCodes.has(code)) {
                try {
                    await delay(150, undefined, { signal: request.signal });
                }
                catch (waitingError) {
                    request.signal.throwIfAborted();
                    throw waitingError;
                }
                continue;
            }
            if (!code)
                throw error;
            const result = retryable ? '本次读取失败，可在连接恢复后重试' : '请求结果未确认，请先检查操作结果再决定是否重试';
            // 仅暴露错误码和固定说明，底层异常中的地址、请求与认证信息不进入提示。
            throw new Error(`思源连接失败（${code}）：${descriptions[code] ?? '网络或 TLS 连接异常'}；${result}`);
        }
    }
}
