/** 只为无请求体的 GET/HEAD 重试一次；同一 URL、凭据和截止信号贯穿两次尝试。 */
export declare function sendRequest(request: Request): Promise<Response>;
