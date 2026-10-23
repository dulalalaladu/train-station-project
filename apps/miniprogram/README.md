# @railvoice/miniprogram

微信小程序（原生 + TypeScript + TDesign + MobX）：语音指令、对讲、告警。（负责 Agent：A-2；骨架由 T-001 建立。）

当前内容：**T-005 音频能力 Spike**（`pages/spike-audio/`）。业务页面尚未开始。

## 目录

| 路径                                                                          | 作用                                                                                        |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `src/pages/spike-audio/`                                                      | Spike 页面（WXML/WXSS/TS），只做 UI 绑定                                                    |
| `src/spike/controller.ts`                                                     | 一次运行的编排：录音 → 能量门限 → 二进制帧 → 单 WS；回声帧 → 抖动缓冲 → WebAudio；JSON 心跳 |
| `src/spike/frame.ts`                                                          | §6.2 二进制帧编解码（`[channel:u8][flags:u8][seq:u16 BE][PCM16LE]`）                        |
| `src/spike/{pcm,jitter,stats,messages,config,report,view-model,synthetic}.ts` | 纯逻辑，Vitest 全覆盖                                                                       |
| `src/spike/wx-adapters.ts`                                                    | `wx.*` 适配层（仅此处依赖微信运行时）                                                       |
| `scripts/build.mjs`                                                           | `src/**/*.ts` → CommonJS 输出到 `dist/`（开发者工具的 `miniprogramRoot`）                   |
| `e2e/spike-audio.e2e.mjs`                                                     | `miniprogram-automator` 开发者工具冒烟用例（见下）                                          |

## 命令

```bash
pnpm --filter @railvoice/miniprogram build       # 生成 dist/
pnpm --filter @railvoice/miniprogram typecheck   # tsc（小程序源码）+ tsc（测试与脚本）
pnpm --filter @railvoice/miniprogram test        # Vitest + 覆盖率（门槛 80%）
pnpm --filter @railvoice/miniprogram lint
```

## 在微信开发者工具中运行 Spike

1. 终端 A：`pnpm --filter @railvoice/ws-echo start`（默认监听 `0.0.0.0:8787`，说明见 `tools/ws-echo/README.md`）。
2. 终端 B：`pnpm --filter @railvoice/miniprogram build`。
3. 开发者工具 → 导入项目 → 目录选 `apps/miniprogram`。AppID 用「测试号」即可（仓库内只放公开占位值 `touristappid`，真实 AppID 只在本机开发者工具里填，不入库）。
4. 详情 → 本地设置：勾选「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」（`project.config.json` 已预置 `urlCheck: false`）。
5. 页面 WS 地址填 `ws://127.0.0.1:8787`；**录音源选「合成音」**（模拟器没有麦克风）→ 开始。
6. 真机联调与完整规程见 `docs/test-plans/miniprogram-audio-spike.md`。

网关地址的构建期注入：`MP_WS_URL=wss://<域名>/ws pnpm --filter @railvoice/miniprogram build` 会把默认地址写进 `dist/env.js`（不入库）。

## 自动化用例（miniprogram-automator）

`pnpm --filter @railvoice/miniprogram e2e`：自动构建、起本机回声服务、用开发者工具 CLI 打开项目，用**合成音**跑 8 秒，断言 WS 连通、分片间隔、上行发包、回声往返、JSON 同连接复用，并把结果写入 `e2e/last-run.json`（不入库）。

- 需要：已安装并登录一次的微信开发者工具、开启「服务端口」、环境变量 `WECHAT_DEVTOOLS_CLI` 指向其 CLI（默认 Windows 安装路径）。
- 开发者工具里**不可用**的能力会在输出中标为 `unavailable` 而不是失败：真实麦克风分片（`RecorderManager.onFrameRecorded`）、录音中断事件、来电/后台行为；WebAudio 是否被模拟器实现也如实标注。这些只能靠真机规程验证。

## 约束

- 小程序不持有任何密钥、不解析意图、不做权限判定（D 决策与策划书 §0）。
- 二进制帧编解码的权威实现将在 `packages/protocol`（T-008）；`src/spike/frame.ts` 因小程序不能引用包外源码而保留一份，字节格式需保持一致。**seq 字节序（大端）为本 Spike 的选择，T-008 需确认。**
