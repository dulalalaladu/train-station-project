import { startMockXfyun } from './server.ts';

const port = Number(process.env['MOCK_XFYUN_PORT'] ?? 8765);
const server = await startMockXfyun({ port });
console.log(`mock-xfyun listening on ${server.baseUrl} (IAT: /v1, RTASR: /ast/communicate/v1)`);
process.on('SIGINT', () => void server.close().then(() => process.exit(0)));
