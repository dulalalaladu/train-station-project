// The mini-program runtime provides these timers/console; wx typings do not declare them
// and tsconfig deliberately has no DOM or Node lib.
declare function setInterval(handler: () => void, timeoutMs: number): number;
declare function clearInterval(handle: number): void;
declare function setTimeout(handler: () => void, timeoutMs: number): number;
declare const console: {
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
};
