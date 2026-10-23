# @railvoice/ws-echo

T-005 联调用的极简 WebSocket 回声服务。**仅用于开发联调，不是网关**，不做鉴权，不要暴露到公网。

## 行为

| 收到                                                        | 回复                                                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 二进制帧 `channel=1`（ASR 上行音频，格式见策划书 §6.2）     | 同样的 `flags`/`seq`/PCM，`channel` 改为 `2` 原样回发                                      |
| 二进制帧但长度 < 4、channel ≠ 1 或 PCM 字节数为奇数         | 丢弃并记日志，连接保持                                                                     |
| JSON `{"type":"ping","ts":<number>}`                        | `{"type":"pong","ts":<原值>,"server_ts":<number>}`                                         |
| JSON `{"type":"cmd.submit","command_id":"…","ts":<number>}` | `{"type":"cmd.state","command_id":"…","state":"received","ts":<服务端>,"echo_ts":<原 ts>}` |
| 其它/非法 JSON                                              | `{"type":"error","code":"BAD_MESSAGE","message":"…"}`                                      |

音频与 JSON 走同一条连接，互不阻塞（对应策划书 §6.2 单连接多路复用）。

## 运行

```bash
pnpm --filter @railvoice/ws-echo start                    # 0.0.0.0:8787
pnpm --filter @railvoice/ws-echo start -- --port 9000
# 弱网模拟（只作用于音频回声，JSON 不受影响），用来调抖动缓冲：
pnpm --filter @railvoice/ws-echo start -- --delay-ms 80 --jitter-ms 60 --drop-pct 2
```

也可用环境变量：`ECHO_PORT`、`ECHO_HOST`、`ECHO_DELAY_MS`、`ECHO_JITTER_MS`、`ECHO_DROP_PCT`。需要 Node 24（直接运行 `.ts`）。

## 让小程序连上本机地址

**开发者工具（模拟器）**：详情 → 本地设置 → 勾选「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」，页面里填 `ws://127.0.0.1:8787`。

**真机**（手机与电脑在同一局域网）：

1. 查电脑局域网 IP（Windows：`ipconfig`），放行防火墙入站 TCP 8787（或所选端口）。
2. 开发者工具点「真机调试」（或「预览」后在手机上打开右上角「…」→ 打开调试），并在手机小程序的 vConsole/设置里打开「开发调试」——开启调试后真机同样不校验合法域名、允许 `ws://` 明文。
3. 页面 WS 地址填 `ws://<电脑局域网IP>:8787`。

> 正式版/体验版必须使用已备案并配置在小程序后台的 `wss://` 域名（owner-actions B-4/B-5），明文 `ws://` 与局域网 IP 只在开启调试时可用。**以真机实际表现为准，若某机型不允许，请把现象记入测试记录表。**

## 测试

`pnpm --filter @railvoice/ws-echo test` 包含：纯逻辑单元测试、真实 WebSocket 服务测试，以及 `test/integration.test.ts`——用 `apps/miniprogram` 的真实 `SpikeController` 经真实 WebSocket 连接本服务（仅录音/播放/定时器用替身），验证整条数据通路。
