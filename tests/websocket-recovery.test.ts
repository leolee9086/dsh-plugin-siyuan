import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import { SiYuanConnection } from '../lib/connection.js';

for (const autoPong of [false, true]) {
  test(`远程WS心跳${autoPong ? '保留正常空闲连接' : '检测无响应连接并关闭'}`, { timeout: 5000 }, async t => {
    const server = createServer();
    const ws = new WebSocketServer({ server, autoPong });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); assert.ok(address && typeof address === 'object');
    const connection = new SiYuanConnection({ apiUrl: `http://127.0.0.1:${address.port}` });
    t.after(async () => {
      await connection.dispose();
      for (const socket of ws.clients) socket.terminate();
      await new Promise<void>(resolve => ws.close(() => resolve()));
      await new Promise<void>(resolve => server.close(() => resolve()));
    });
    const accepted = once(ws, 'connection');
    const socket = await connection.ws.open('/ws', { heartbeatMs: 50 });
    await accepted;
    if (!autoPong) {
      await once(socket, 'close'); assert.equal(socket.readyState, socket.CLOSED);
    } else {
      // 等待两轮真实协议pong，比任意时间后检查状态更能证明空闲存活。
      await once(socket, 'pong'); await once(socket, 'pong');
      assert.equal(socket.readyState, socket.OPEN);
    }
  });
}

for (const status of [401, 403, 429] as const) {
  test('WS握手HTTP ' + status + '保留安全暂停分类并释放连接', { timeout: 5000 }, async t => {
    let calls = 0;
    const server = createServer((_request, response) => {
      calls++;
      response.writeHead(status, { 'retry-after': '42' }); response.end('fixture-private-response');
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); assert.ok(address && typeof address === 'object');
    const connection = new SiYuanConnection({ apiUrl: 'http://127.0.0.1:' + address.port });
    t.after(async () => { await connection.dispose(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
    let finish!: (error?: Error) => void;
    const closed = new Promise<Error | undefined>(resolve => { finish = resolve; });
    await assert.rejects(connection.ws.open('/ws', { onClose: finish }), error => {
      const pause = SiYuanConnection.pushPause(error);
      assert.equal(pause?.reason, status === 401 ? 'authentication' : status === 403 ? 'permission' : 'rate-limit');
      assert.equal(pause?.retryAfterSeconds, 42);
      assert.ok(!pause?.message.includes('fixture-private-response'));
      return true;
    });
    assert.ok(SiYuanConnection.pushPause(await closed));
    assert.equal(calls, 1);
  });
}

test('标准未认证关闭原因暂停认证重连', { timeout: 5000 }, async t => {
  const server = createServer();
  const ws = new WebSocketServer({ server });
  ws.on('connection', socket => socket.close(1008, '  unauthenticated'));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const connection = new SiYuanConnection({ apiUrl: 'http://127.0.0.1:' + address.port });
  t.after(async () => {
    await connection.dispose(); for (const socket of ws.clients) socket.terminate();
    await new Promise<void>(resolve => ws.close(() => resolve()));
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  let finish!: (error?: Error) => void;
  const closed = new Promise<Error | undefined>(resolve => { finish = resolve; });
  await connection.ws.open('/ws', { onClose: finish });
  assert.equal(SiYuanConnection.pushPause(await closed)?.reason, 'authentication');
});

for (const payload of ['  unauthenticated', '  invalid query']) {
  test('原样关闭载荷 ' + payload.trim() + '只分类为协议错误', { timeout: 5000 }, async t => {
    const server = createServer();
    const peers = new Set<Duplex>();
    server.on('upgrade', (request, socket) => {
      peers.add(socket); socket.on('close', () => peers.delete(socket));
      socket.resume();
      const accept = createHash('sha1').update(String(request.headers['sec-websocket-key']) + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      socket.on('error', () => {});
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
      // 按已核对的 CloseWithMsg 载荷发送真实关闭帧，不补一个合法的关闭码。
      const bytes = Buffer.from(payload);
      socket.end(Buffer.concat([Buffer.from([0x88, bytes.length]), bytes]));
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); assert.ok(address && typeof address === 'object');
    const connection = new SiYuanConnection({ apiUrl: 'http://127.0.0.1:' + address.port });
    t.after(async () => {
      await connection.dispose(); for (const peer of peers) peer.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    });
    let finish!: (error?: Error) => void;
    const closed = new Promise<Error | undefined>(resolve => { finish = resolve; });
    await connection.ws.open('/ws', { onClose: finish });
    const pause = SiYuanConnection.pushPause(await closed);
    assert.equal(pause?.reason, 'protocol');
    assert.match(pause!.message, /无效关闭帧/);
  });
}
