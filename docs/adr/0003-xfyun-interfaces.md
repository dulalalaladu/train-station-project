# ADR 0003 — 讯飞三接口：实现与联调结论

- **状态**：初稿（第一段完成：已按官方文档实现并对本地回放服务通过；**尚未用真实密钥验证**）
- **任务**：T-003（DOU-5）　**负责人**：A-4 语音与意图工程师
- **依据**：策划书 §1.4、§3.3、§4.4.1、§7.1、§7.2、§12.4；约束 D-07（ASR 走后端代理）
- **代码**：`tools/xfyun-spike/`（TypeScript / Node 24，不依赖讯飞 SDK）
- **图例**：✅ 已按官方文档实现（并有测试）　⚠️ 待真实密钥验证　❗ 与需求书/文档冲突（第二段填写）

> 注意：✅ 仅表示「实现与官方文档一致、签名与帧格式有单元测试、客户端与本地回放服务端到端通过」。
> 本地回放服务由我们自己按文档写成，**不能证明真实服务端行为**；延迟数字目前一律不可引用。

## 1. 决策

1. 三条接口均由网关后端直连（D-07），密钥只从环境变量读取：`XFYUN_APP_ID`、`XFYUN_API_KEY`、`XFYUN_API_SECRET`、`XFYUN_RTASR_ACCESS_KEY_ID`、`XFYUN_RTASR_ACCESS_KEY_SECRET`；缺失即报错，不使用占位值。
2. 不使用需求书中的旧版参数：`accent=mulacc`、`ptt`、`nunum`、`nbest/wbest`（官方大模型听写已无这些参数）。
3. 动态修正（`dwa=wpgs`）在网关用不可变合并器处理（`src/merger/wpgs-merger.ts`），T-103 直接复用。
4. 英语模式方案**待第二段决定**（§5），在此之前 `en_us` 在适配层保持两种实现可切换。

## 2. 接口核对表

### 2.1 语音听写大模型（`wss://iat.xf-yun.com/v1`）

| 项 | 状态 | 说明 / 代码位置 |
|---|---|---|
| 端点与路径 | ✅ | `src/clients/endpoints.ts` |
| 鉴权：HMAC-SHA256 签 `host date request-line`；`authorization`=Base64(`api_key=…, algorithm="hmac-sha256", headers="host date request-line", signature=…`)；`authorization/date/host` 放 query | ✅ | `src/auth/iat-auth.ts`；固定时间+假密钥的确定性用例，期望值由 .NET HMAC **独立计算**（`tests/auth.test.ts`） |
| `date` 为 RFC1123 GMT，允许 ±300 s | ✅ 格式 / ⚠️ 超限时的真实 HTTP 状态与消息 | 本地回放用 403，真实值待记录 |
| 首帧 `header{app_id,res_id?,status:0}` + `parameter.iat{domain=slm,language=zh_cn,accent=mandarin,dwa=wpgs,eos,ltc,dhw,result{encoding=utf8,compress=raw,format=json}}` + `payload.audio` | ✅ | `src/protocol/iat-frames.ts` |
| 中间帧 `status=1`、尾帧 `status=2` 且 `audio` 为空；`seq` 递增 | ✅ | 同上 |
| 音频 raw / 16 kHz / 16 bit / 单声道，1280 B / 40 ms 匀速（按起点计时，抖动不累积） | ✅ | `src/audio/pcm.ts`（`sendPaced`），回放服务实测帧间距 |
| 响应：`header{code,message,sid,status}`，`payload.result.text` 为 Base64 JSON `{sn,ls,pgs,rg,ws[].cw[].w}` | ✅ | 官方页同一页面里 `pgs/rg` 路径写作 `data.result` 与 `payload.result` 两种，**以真实响应为准** ⚠️ |
| `pgs=apd/rpl` + `rg` 动态修正合并 | ✅ | 7 个用例（追加、整段替换、部分替换、无 pgs、重复 sn、缺 rg、不可变） |
| `dhw` 会话热词 `utf-8;词1\|词2` ≤1024 B | ✅ 构造与长度校验 / ⚠️ 实际生效 | `buildDhw` |
| `header.res_id` 控制台热词 | ✅ 传参 / ⚠️ 实际生效（需业主在控制台上传热词取得 `res_id`） | |
| `ltc` 1 不过滤 / 2 仅中文 / 3 仅英文 | ✅ 传参 / ⚠️ 行为（尤其 `ltc=3`） | §5 |
| `eos` 静音超时（ms） | ✅ 传参，默认 6000 / ⚠️ 最小有效值与短指令的最佳取值 | |
| 单条 ≤60 s；并发 50 路 | ⚠️ 控制台确认 | |
| `header.code != 0` 仍可能 `ret` 失败（官方说明：`code=0` 不保证识别成功） | ⚠️ 真实响应中 `ret` 字段位置 | 现按 `code` 判错 |

### 2.2 大模型多语种语音识别（`wss://iat.cn-huabei-1.xf-yun.com/v1`）

| 项 | 状态 | 说明 |
|---|---|---|
| 端点、同一鉴权方式 | ✅ | 同 `buildIatAuthUrl`，host 参与签名（有测试） |
| 请求信封（header / parameter.iat / payload.audio） | ⚠️ 按听写接口信封实现 | 官方页面未能取到，以真实握手为准 |
| 语种参数 | ⚠️ **未核实**：默认 `language=en_us` 仅为占位，CLI `--language` 可改 | 第二段按官方文档逐个试 |
| 是否支持 `dhw` / `res_id` / `dwa=wpgs` / `ltc` | ⚠️ | 目前只传 `dhw`，不传 `dwa` |
| 并发 / 计费 / 是否需单独开通 | ⚠️ 业主行动项 B-1 | |

### 2.3 实时语音转写大模型（`wss://office-api-ast-dx.iflyaisol.com/ast/communicate/v1`）

| 项 | 状态 | 说明 |
|---|---|---|
| 鉴权：参数按名排序，key/value 严格 urlencode（含 `!'()*`），HMAC-SHA1(accessKeySecret)+Base64 → `signature`；含 `appId`、`accessKeyId`、`utc`、`uuid` | ✅ 算法按策划书 / ⚠️ `utc` 具体格式 | 实现为 `yyyy-MM-ddTHH:mm:ss+0800`（`formatRtasrUtc`，偏移可改）；期望签名由 .NET HMAC 独立计算 |
| 握手参数 `lang=autodialect`、`audio_encode=pcm_s16le`、`samplerate=16000`、`eng_vad_mdn`（1 远场 / 2 近场） | ✅ | `src/clients/rtasr-client.ts` |
| 音频以二进制帧发送，1280 B / 40 ms；结束发 `{"end":true}` | ✅ | |
| 响应结构 | ⚠️ **未能取得官方文档页**（猜测的文档地址 404，检索无结果）。解析器按厂商示例假设：`msg_type=action/result`，`data.action=started/error`，`data.cn.st.type`（0 最终 / 1 中间），`data.cn.st.rt[].ws[].cw[].w`，`data.seg_id`；解析器对未知结构返回 `unknown` 而不是崩溃 | `src/protocol/rtasr-frames.ts` |
| 15 s 无音频断连、单会话 ≤8 h、默认 10 路 | ⚠️ | 第二段实测（含空闲断连） |
| 热词在控制台配置 | ⚠️ 需业主操作 | |

## 3. 错误码表（待核验）

> 下表**不是**从官方大模型听写页核对得来（该页没有错误码表，只写「非 0 即异常」）。IAT 系列通用码来自讯飞开放平台通用错误码的既有记录，需在第二段用真实请求逐条复现/核对后改成 ✅。`35xxx` 的具体含义策划书只给了「鉴权/配额类」，**需用真实失败请求补全**。

| 码 / 状态 | 含义（待核） | 出现位置 | 网关处理（§7.2 第 4 条） |
|---|---|---|---|
| HTTP 401（握手） | 签名无法验证（密钥/签名串错误） | 握手 | 不重试，运维告警 |
| HTTP 403（握手） | 日期超出 ±300 s / 无授权 | 握手 | 不重试，检查 NTP |
| 10005 / 10010 / 11200 | appid 无授权 / 引擎授权不足 / 功能未授权或超量 | `header.code` | 配额类：告警，小程序退化为文字输入 |
| 11201 | 日流控超限 | `header.code` | 同上 |
| 10006 / 10007 / 10160 / 10163 | 缺参数 / 参数值无效 / 请求格式非法 / 参数校验失败 | `header.code` | 代码缺陷：记录 sid，不重试 |
| 10161 | base64 解码失败 | `header.code` | 同上 |
| 10043 | 音频解码失败 | `header.code` | 检查采样率/位深 |
| 10114 / 10200 | 会话超时 / 读数据超时 | `header.code` | 重试 1 次 |
| `35xxx` | 鉴权 / 配额类（策划书 §7.2） | 待记录 | 告警 |
| 并发已满 | ⚠️ 未知 | 待复现 | 网关自身令牌桶先拦截，回 `ASR_BUSY` |

第二段需要**真实触发并记录**：错误密钥、故意错位时钟（>300 s）、超出并发、超长音频（>60 s）、非法参数；记录 HTTP 状态 / `header.code` / `message` / `sid`。

## 4. 本地回放服务（`tools/xfyun-spike/mock/`）

- 校验与真实服务同样的签名（IAT：HMAC-SHA256 + ±300 s；RTASR：排序 urlencode + HMAC-SHA1），不通过返回 401/403。
- 校验帧：首帧 status 0、单帧 ≤1280 B；记录每帧到达时间用于验证 40 ms 节奏；`{"end":true}` 记录。
- 按脚本回放 `apd → apd → rpl[1,2] → apd` 的 wpgs 序列，`header.status=2` 结束；`scenario: 'api-error'` 回放错误码。
- 凭据为固定假值（`mock/credentials.ts`），CLI 的 `--mock` 只接受回环地址，避免假凭据发往外网。
- 该服务也是 `mock-xfyun`（策划书 §4.5）的雏形；T-103 / T-110 可在此基础上扩展。

## 5. 英语模式（`en_us`）候选与验证计划

| | 方案 A：多语种接口（`iat.cn-huabei-1.xf-yun.com`） | 方案 B：听写大模型 `ltc=3`（仅英文） |
|---|---|---|
| 优点 | 官方面向多语种；美式英语口音更可能达标 | 同一端点/鉴权/帧格式，无需额外开通；支持 `dwa=wpgs`、`dhw`、`res_id` |
| 风险 | 需单独开通（B-1）；语种参数、热词/动态修正支持不明；多一套并发配额 | 「仅英文」是过滤而非专用模型，纯英文短指令识别率未知 |
| 待验证 | 语种参数取值；`dhw`/`wpgs` 是否支持；首字/最终延迟 | `ltc=3` 下英文指令识别率；是否漏识别/误译成中文 |

验证方法（第二段）：
1. 测试集：英文指令词（Stop / Halt / Follow me / Return to base / Start patrol 等，取自 `docs/seed/command-lexicon.v1.json` 的英文等价）× 合成语音（`fixtures/`，SAPI en-US）；有条件时补充人工朗读样本（不入库）。
2. 两方案各跑 ≥20 次/句：记录识别文本、命中率（词库归一化后）、首字延迟、最终延迟（P50/P95）。
3. 额外对比 `ltc=1`（不过滤）下的英文识别，作为 `zh_en_mixed` 参照。
4. 判定标准（暂定，评审可调整）：英文指令命中率 ≥95%（与策划书 KWS 召回口径一致）、最终延迟 P95 ≤ 400 ms（§3.3 预算）、无需额外商务开通者优先。
5. 结论写回本 ADR §5，并同步 §7.1 的 `en_us` 行；如需改动 D-xx 级决策，按 §9.5 提「决策变更申请」。

## 6. 第二段（密钥到位后）检查清单

对应任务卡第 5～6 条，全部用 `node src/main.ts <slm|multilingual|rtasr> --audio fixtures/<clip>.pcm --runs 20 --out <report>.json`：

- [ ] 三接口握手成功（记录 HTTP 状态与 `sid`，不记录密钥/签名 URL）
- [ ] 首字延迟与最终延迟，各 ≥20 次，P50 / P95（含 `ltc=1/2/3`）
- [ ] `dhw` 与 `res_id` 热词是否生效（用「道岔/股道/溜逸/侵限」对照）
- [ ] 英语模式方案定论（§5）
- [ ] `eos` 对短指令（<2 s）最终延迟的影响；尾部静音策略（§7.2 第 1 条的空帧保活）
- [ ] RTASR 响应结构、`utc` 格式、15 s 无音频断连行为
- [ ] 错误码表（§3）逐条复现；并发满的真实表现
- [ ] 中文测试音频：本机没有 zh-CN 语音，需业主允许使用的 TTS（或脱敏自录），**不得入库真人录音**
- [ ] 更新本 ADR 为 ✅/❗ 终稿；列出需要修订的需求书条目（若有）为「决策变更申请」

## 7. 需求书修订候选（初稿，无需决策变更申请）

- 无。（旧版参数已在策划书 §1.4 处理；是否需要变更申请取决于 §5 的英语方案与第二段实测。）

## 8. 给 T-103（ASR 代理模块）的复用清单

| 需要 | 直接复用 |
|---|---|
| 听写/多语种签名 URL | `src/auth/iat-auth.ts` |
| 转写签名 URL | `src/auth/rtasr-auth.ts` |
| 帧构造与响应解析 | `src/protocol/iat-frames.ts`、`rtasr-frames.ts`（zod 校验） |
| 动态修正合并 | `src/merger/wpgs-merger.ts` |
| 40 ms 匀速发送 | `src/audio/pcm.ts` |
| WS 握手错误 → `HandshakeError`，业务错误码 → `XfyunApiError` | `src/errors.ts`、`src/clients/socket.ts` |
| CI 用 MockProvider | `mock/` |

实现中发现的坑（已修复，T-103 注意）：服务端可能在握手完成后立即下发消息（RTASR 的 `started`），客户端必须在 `open` 之前就开始缓冲消息，否则会丢首条消息（`openSocket` / `onMessage`）。
