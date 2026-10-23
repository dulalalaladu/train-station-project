/** Application-level error returned by an Xunfei interface (header.code != 0 etc). */
export class XfyunApiError extends Error {
  readonly code: number | string;
  readonly sid: string | undefined;

  constructor(code: number | string, message: string, sid?: string) {
    super(`Xunfei error ${code}: ${message}`);
    this.name = 'XfyunApiError';
    this.code = code;
    this.sid = sid;
  }
}

/** Handshake rejected (HTTP 401/403 on upgrade): bad signature, clock skew, no quota. */
export class HandshakeError extends Error {
  readonly httpStatus: number;

  constructor(httpStatus: number, detail: string) {
    super(`WebSocket handshake rejected with HTTP ${httpStatus}: ${detail}`);
    this.name = 'HandshakeError';
    this.httpStatus = httpStatus;
  }
}

export class SessionTimeoutError extends Error {
  constructor(what: string, ms: number) {
    super(`Timed out after ${ms} ms waiting for ${what}`);
    this.name = 'SessionTimeoutError';
  }
}
