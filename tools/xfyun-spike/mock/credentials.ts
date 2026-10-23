import type { IatCredentials, RtasrCredentials } from '../src/config.ts';

/**
 * Fake credentials accepted only by the local mock server. They are not real
 * keys; the CLI refuses to use them against anything but a loopback host.
 */
export const MOCK_IAT_CREDENTIALS: IatCredentials = {
  appId: 'mock-app-id',
  apiKey: 'mock-api-key',
  apiSecret: 'mock-api-secret',
};

export const MOCK_RTASR_CREDENTIALS: RtasrCredentials = {
  appId: 'mock-app-id',
  accessKeyId: 'mock-access-key-id',
  accessKeySecret: 'mock-access-key-secret',
};
