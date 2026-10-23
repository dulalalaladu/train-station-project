export function renderEnvModule(wsUrl: string): string;
export function buildMiniprogram(options: {
  srcDir: string;
  outDir: string;
  env?: Record<string, string | undefined>;
}): Promise<string[]>;
