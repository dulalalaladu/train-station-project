import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { startEchoServer, type EchoServer } from '../src/server.ts';

const open: { server: EchoServer | undefined; clients: WebSocket[] } = {
  server: undefined,
  clients: [],
};

afterEach(async () => {
  open.clients.forEach((c) => c.terminate());
  open.clients = [];
  await open.server?.close();
  open.server = undefined;
});

async function connect(server: EchoServer): Promise<WebSocket> {
  const client = new WebSocket(`ws://127.0.0.1:${server.port}`);
  open.clients.push(client);
  await new Promise<void>((resolve, reject) => {
    client.once('open', () => resolve());
    client.once('error', reject);
  });
  return client;
}

function nextMessage(client: WebSocket): Promise<{ data: Buffer; isBinary: boolean }> {
  return new Promise((resolve) =>
    client.once('message', (data: Buffer, isBinary: boolean) => resolve({ data, isBinary })),
  );
}

const asrFrame = Uint8Array.from([1, 0, 0, 7, 10, 20, 30, 40]);

describe('startEchoServer', () => {
  it('echoes channel 1 audio frames back as channel 2', async () => {
    open.server = await startEchoServer({ port: 0, host: '127.0.0.1' });
    const client = await connect(open.server);
    const reply = nextMessage(client);
    client.send(asrFrame, { binary: true });
    const { data, isBinary } = await reply;
    expect(isBinary).toBe(true);
    expect(Array.from(data)).toEqual([2, 0, 0, 7, 10, 20, 30, 40]);
  });

  it('answers JSON ping with pong while audio flows on the same socket', async () => {
    open.server = await startEchoServer({ port: 0, host: '127.0.0.1', now: () => 42 });
    const client = await connect(open.server);
    const got: string[] = [];
    client.on('message', (data: Buffer, isBinary: boolean) =>
      got.push(isBinary ? 'bin' : data.toString()),
    );
    client.send(asrFrame, { binary: true });
    client.send(JSON.stringify({ type: 'ping', ts: 1 }));
    await new Promise((r) => setTimeout(r, 100));
    expect(got).toContain('bin');
    expect(got).toContain(JSON.stringify({ type: 'pong', ts: 1, server_ts: 42 }));
  });

  it('ignores malformed binary frames and keeps serving', async () => {
    const lines: string[] = [];
    open.server = await startEchoServer({ port: 0, host: '127.0.0.1', log: (l) => lines.push(l) });
    const client = await connect(open.server);
    client.send(Uint8Array.from([9, 9]), { binary: true });
    const reply = nextMessage(client);
    client.send(asrFrame, { binary: true });
    expect((await reply).isBinary).toBe(true);
    expect(lines.some((l) => l.includes('dropped'))).toBe(true);
  });

  it('drops audio echoes when the impairment says so, but still answers JSON', async () => {
    open.server = await startEchoServer({
      port: 0,
      host: '127.0.0.1',
      impairment: { dropPct: 100 },
      random: () => 0,
    });
    const client = await connect(open.server);
    const got: string[] = [];
    client.on('message', (data: Buffer, isBinary: boolean) => got.push(isBinary ? 'bin' : 'text'));
    client.send(asrFrame, { binary: true });
    client.send(JSON.stringify({ type: 'ping', ts: 1 }));
    await new Promise((r) => setTimeout(r, 100));
    expect(got).toEqual(['text']);
  });

  it('delays audio echoes by the configured base delay', async () => {
    open.server = await startEchoServer({
      port: 0,
      host: '127.0.0.1',
      impairment: { delayMs: 80 },
    });
    const client = await connect(open.server);
    const started = Date.now();
    const reply = nextMessage(client);
    client.send(asrFrame, { binary: true });
    await reply;
    expect(Date.now() - started).toBeGreaterThanOrEqual(70);
  });
});
