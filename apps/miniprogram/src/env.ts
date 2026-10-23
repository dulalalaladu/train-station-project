// Build-time configuration. `pnpm build` regenerates dist/env.js from the MP_WS_URL environment
// variable when it is set (never commit a real gateway address or any credential here).
// The AppID is not stored in the repo: project.config.json carries the public `touristappid`
// placeholder; set the real one in the WeChat developer tool or pass it to miniprogram-ci.
export const ENV: { readonly wsUrl: string } = {
  wsUrl: 'ws://127.0.0.1:8787',
};
