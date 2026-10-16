import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type RequestListener } from 'node:http';
import { once } from 'node:events';
import { SiYuanConnection } from '../lib/connection.js';

async function remote(t: TestContext, handler: RequestListener, timeoutMs = 3000) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  // 显式 URL 模式模拟远程反向代理，不依赖 PID 或端口登记文件。
  const connection = new SiYuanConnection({ apiUrl: `http://127.0.0.1:${address.port}/proxy`, timeoutMs });
  t.after(async () => {
    await connection.dispose();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  return connection;
}

test('远程GET在503后按Retry-After恢复，代理前缀保持，认证失败不重试', async t => {
  let calls = 0;
  const connection = await remote(t, (request, response) => {
    assert.equal(request.url, '/proxy/status');
    calls++;
    response.writeHead(calls === 1 ? 503 : calls === 2 ? 200 : 401, { 'retry-after': '0' });
    response.end(calls === 2 ? 'ready' : 'unavailable');
  });
  assert.equal(await (await connection.http.request('/status')).text(), 'ready');
  assert.equal(calls, 2);
  const denied = await connection.http.request('/status');
  assert.equal(denied.status, 401); await denied.body?.cancel();
  assert.equal(calls, 3);
});

test('远程读取收到429时保留Retry-After且不自动重试', async t => {
  let calls = 0;
  const connection = await remote(t, (_request, response) => {
    calls++;
    response.writeHead(429, { 'retry-after': '30' }); response.end('rate limited');
  });
  const response = await connection.http.request('/status');
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '30');
  assert.equal(await response.text(), 'rate limited');
  assert.equal(calls, 1);
});

test('远程读取重置只重试一次，写入重置不重放，下一次主动调用可恢复', async t => {
  let calls = 0, fail = true;
  const connection = await remote(t, (request, response) => {
    calls++;
    if (fail) request.socket.destroy();
    else response.end('recovered');
  });
  await assert.rejects(connection.http.request('/status'), /ECONNRESET|UND_ERR_SOCKET/);
  assert.equal(calls, 2);
  await assert.rejects(connection.http.request('/write', { method: 'POST', body: 'once' }), /结果未确认/);
  assert.equal(calls, 3);
  fail = false;
  assert.equal(await (await connection.http.request('/write', { method: 'POST', body: 'next' })).text(), 'recovered');
  assert.equal(calls, 4);
});

test('远程重试共用总超时，取消在退避期间生效，长Retry-After交回调用方', async t => {
  let calls = 0, retryAfter = '1';
  let received = () => {};
  const connection = await remote(t, (request, response) => {
    if (request.url === '/proxy/warmup') { response.end('ready'); return; }
    calls++;
    response.writeHead(503, { 'retry-after': retryAfter }); response.end('later');
    received();
  });
  // 连接初始化不属于退避断言；先完成一次往返，再用短于 Retry-After 的总预算。
  assert.equal(await (await connection.http.request('/warmup')).text(), 'ready');
  await assert.rejects(connection.http.request('/status', { timeoutMs: 500 }), /timeout/i);
  assert.equal(calls, 1);
  const controller = new AbortController(), reason = new Error('stop remote request');
  const arrived = new Promise<void>(resolve => { received = resolve; });
  const pending = assert.rejects(connection.http.request('/status', { signal: controller.signal }), error => error === reason);
  await arrived;
  const timer = setTimeout(() => controller.abort(reason), 50);
  try { await pending; }
  finally { clearTimeout(timer); }
  assert.equal(calls, 2);
  retryAfter = '60';
  const response = await connection.http.request('/status');
  assert.equal(response.status, 503); await response.body?.cancel();
  assert.equal(calls, 3);
});

test('远程POST收到服务不可用只发送一次，流式响应中断不重放', async t => {
  let calls = 0;
  const connection = await remote(t, (request, response) => {
    calls++;
    if (request.method === 'POST') { response.writeHead(503); response.end('later'); }
    else { response.writeHead(200, { 'content-length': '100' }); response.write('partial'); setTimeout(() => response.destroy(), 30); }
  });
  const write = await connection.http.request('/write', { method: 'POST', body: 'once' });
  assert.equal(write.status, 503); await write.body?.cancel();
  assert.equal(calls, 1);
  const read = await connection.http.request('/stream');
  await assert.rejects(read.text());
  assert.equal(calls, 2);
});
