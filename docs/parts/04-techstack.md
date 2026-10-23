
---

## 4. 技术栈详解

### 4.1 前端

#### 4.1.1 微信小程序（作业人员手持端）

| 项目 | 选型 | 说明 |
|---|---|---|
| 语言 | TypeScript 5.x | 小程序官方模板支持 TS；与云端共享 `packages/protocol` 类型 |
| 框架 | 原生小程序框架（WXML/WXSS/TS），基础库最低 2.27.3 | 不用 Taro/uni-app：录音分片、WebSocket、WebAudio 等底层 API 在跨端框架下容易被封装层干扰；本项目没有多端诉求（D-01） |
| 渲染 | 默认 WebView 渲染；状态面板可选 Skyline | 稳定优先 |
| UI 组件 | TDesign Miniprogram（腾讯官方开源） | 国内维护活跃、无障碍与暗色适配好；备选 Vant Weapp |
| 状态管理 | `mobx-miniprogram` + `mobx-miniprogram-bindings` | 实时状态（狗的电量/位置/任务）多页共享 |
| 网络 | `wx.request`（REST）+ `wx.connectSocket`（单条 WSS 多路复用：音频、指令、状态、对讲、告警） | 只占 1 个 WS 连接，远低于 5 个上限 |
| 录音 | `wx.getRecorderManager().start({ format:'PCM', sampleRate:16000, numberOfChannels:1, frameSize:2, duration:60000 })` + `onFrameRecorded` | `frameSize` 单位 KB；2 KB ≈ 64 ms 音频；需求书要求的 1280 B/40 ms 分片由网关重新切帧 |
| 播放 | `wx.createWebAudioContext()`（基础库 2.19.0+）：`createBuffer` 写入 Float32 PCM → `createBufferSource().start(scheduledTime)` 连续调度 | 用于 PTT 对讲接收与狗端回传语音原声；短提示音用 `InnerAudioContext` |
| 地图 | `map` 组件（腾讯位置服务）+ 站场平面图叠加（`cover-image`/`canvas` 自定义坐标系） | 室内/股道间 GPS 不可靠，以站场局部坐标系为主（§6.1 `zones/waypoints`） |
| 推送 | 订阅消息（一次性订阅，告警到达时触发）+ WS 在线推送 | 小程序在后台时靠订阅消息唤起 |
| 权限 | `scope.record`、`scope.userLocation`、相机（扫码绑定设备） | 首次进入引导授权 |
| 工程化 | `miniprogram-ci` 自动上传体验版；ESLint + Prettier；Vitest 测试纯逻辑（协议编解码、状态机、词库本地缓存） | 真机 E2E 用微信开发者工具自动化（`miniprogram-automator`） |
| 构建 | pnpm workspace 子包 `apps/miniprogram`；`tsc` + 微信开发者工具编译 | 共享包通过 `npm 构建` 引入 |

小程序页面清单（P0）：登录与绑定 → 主控台（语音按钮、语言切换、识别回显、快捷指令、狗状态卡片）→ 指令记录（三级回执）→ 地图选点 → 对讲 → 告警列表/详情（媒体、原声、转工单）→ 我的（语言偏好、授权设备）。

#### 4.1.2 管理后台 Web

| 项目 | 选型 |
|---|---|
| 语言/框架 | TypeScript + React 18 + Vite |
| UI | Ant Design 5 + Ant Design Pro Components（表格、表单、权限路由） |
| 数据层 | TanStack Query + 自动生成的 OpenAPI 客户端（来自 NestJS Swagger） |
| 地图/平面图 | 腾讯地图 JS API GL + 自定义平面图标注工具（上传站场平面图、标注区域/巡检点/禁区） |
| 测试 | Vitest + React Testing Library；Playwright E2E |

功能模块：用户与角色、站场与区域、设备与固件/OTA、词库三元组与热词、喊话语句库（中/英）、告警策略、指令日志与录音检索（带播放器与转写文本）、告警归档与工单、讯飞配额监控、系统审计。

### 4.2 云端

#### 4.2.1 运行时与框架

| 项目 | 选型 | 理由 |
|---|---|---|
| 运行时 | Node.js 24 LTS | 当前 LTS；事件驱动模型适合大量并发 WebSocket 音频流中继 |
| 框架 | NestJS 11（TypeScript） | 模块化、依赖注入、内置 WebSocket 网关（`@nestjs/websockets` + `ws`）、Swagger、Guards 做 RBAC |
| 校验 | zod（协议 schema 单一来源，生成 JSON Schema 给狗端 Python 侧用 pydantic 校验） | 跨语言协议一致 |
| ORM | Prisma 6 + Prisma Migrate | 迁移可审计；Agent 熟悉 |
| 队列 | BullMQ（Redis） | 告警扇出、录音转码、离线补传对账、热词同步等异步任务 |
| MQTT | EMQX 5 开源版（容器）；云端用 `mqtt.js` 作为共享订阅客户端（`$share/gw/dog/+/up/#`） | 设备侧会话保持、QoS、ACL、mTLS、离线消息；国产项目、文档完善 |
| 讯飞 SDK | 不用官方 SDK，直接实现 WebSocket 协议（官方示例为 Python/Java；Node 自行实现 HMAC 签名） | 便于控制重连、复用、计量 |
| 音频处理 | 网关只做切帧/转码：PCM→Opus（`@discordjs/opus` 或 `opusscript`）用于留存；不做 AEC/降噪 | DSP 在端侧 |
| LLM（可选） | OpenAI 兼容客户端指向国产模型（讯飞星火 / 阿里百炼-通义千问 / DeepSeek），默认关闭 | 见 §7.2.6 与 §12.1 |
| 文档 | Swagger/OpenAPI 3 自动生成；AsyncAPI 描述 WS/MQTT 消息 | 给前端与狗端生成客户端 |
| 测试 | Vitest（单元）+ Supertest（HTTP）+ Testcontainers（PostgreSQL/Redis/EMQX 集成测试）+ k6（压测） | 见 §10 |

#### 4.2.2 NestJS 模块划分（单体内的边界）

```
apps/gateway/src/
  auth/            微信登录、JWT、刷新、RBAC Guard、设备证书签发
  users/           人员、角色、站段归属、语言偏好
  stations/        站场、区域、巡检点、平面图、坐标系
  devices/         狗注册、证书、固件、在线状态、遥测接入
  asr/             讯飞适配层（SlmIatProvider、RtasrProvider、Mock）、会话管理、计量
  nlu/             规范化、词库索引、匹配、置信度、急停前置匹配、LLM 兜底（可插拔）
  lexicon/         三元组 CRUD、版本、热更新发布、热词同步到讯飞控制台（人工）/会话 dhw
  commands/        指令状态机、优先级、幂等、过期、回执、日志
  intercom/        PTT 会话、音频中继、转写字幕、录音
  alerts/          事件接入、规则引擎、分级、静默、去重、扇出（WS/订阅消息/企微/钉钉）、工单
  announcements/   喊话语句库、循环播报策略、远程触发
  recordings/      录音对象存储、留存策略、检索、哈希链
  audit/           审计日志
  realtime/        小程序 WebSocket 网关（多路复用协议）
  mqtt/            EMQX 客户端、主题路由、设备侧协议编解码
  admin/           管理后台 API
  observability/   指标、追踪、健康检查
```

#### 4.2.3 数据存储

| 组件 | 版本 | 用途 | 备注 |
|---|---|---|---|
| PostgreSQL | 16 | 业务数据、指令日志、告警、审计 | 扩展：PostGIS（点位/区域）、`pgcrypto`；遥测按天分区；生产可用 TimescaleDB 替代分区 |
| Redis | 7 | 会话、在线状态、指令状态缓存、限流令牌桶、Pub/Sub、BullMQ | 开启 AOF |
| 对象存储 | MinIO（自托管，S3 API）/ 腾讯云 COS | 录音（Opus）、照片、短视频、平面图 | 服务端加密（SSE-KMS/SM4）；生命周期规则实现留存策略 |
| EMQX | 5.x | 设备消息总线 | 持久会话、保留消息、规则引擎可直接写入审计 |

### 4.3 机器狗端（边缘）

#### 4.3.1 硬件参考 BOM（需采购，见 §12.1）

| 部件 | 原型（Go2 EDU） | 试点/生产（X30 级） | 说明 |
|---|---|---|---|
| 本体 | 宇树 Go2 EDU（含 Jetson Orin NX 8/16 GB）⚠️ IP 等级未公布 | 云深处 X30 / X30 Pro（IP67，-20～55 ℃，约 2.5～4 h，支持自动回充）✅ 经销商资料 | X30 的扩展计算单元与 ROS 2 支持需向厂商确认 ⚠️ |
| 机载计算 | Go2 EDU 自带 Orin NX | Orin NX 16 GB 载荷模块（或厂商感知主机） | Ubuntu 22.04 / JetPack 6 |
| 麦克风阵列 | USB 环形 4 麦阵列，带硬件 AEC/AGC/波束成形/DoA（如 ReSpeaker XVF3800 系列）✅ | 工业级 IP 防护麦克风阵列（可咨询讯飞/国产模组厂商）⚠️ | 硬件 AEC 需要把扬声器信号回灌作为参考 |
| 喊话器 | 车载号角喇叭 + D 类功放（≥30 W，≥100 dB@1 m） | 同左，IP65 | 由计算单元 3.5 mm/USB 声卡 → 功放 |
| 爆闪灯 | 红蓝/红白 LED 爆闪灯 + 继电器（GPIO） | 同左 | 可与喊话联动 |
| 通信 | 5G CPE/工业路由（SIM）+ Wi-Fi 6 | 5G 专网 CPE / 铁路专网终端 / MESH 节点 | 双链路切换 |
| 供电 | 本体扩展电源口 12/24 V | 同左 | 功放峰值电流需核算 |

#### 4.3.2 软件栈

| 项目 | 选型 |
|---|---|
| 操作系统 | Ubuntu 22.04 LTS（JetPack 6 on Jetson） |
| 中间件 | ROS 2 Humble（LTS 至 2027-05） |
| 语言 | Python 3.10（rclpy）为主；对延迟敏感的音频环路用 C++（rclcpp）或 Python + `sounddevice` 回调 |
| 容器 | 每个功能组一个 Docker 镜像（arm64），`docker compose` 编排，`--network host` 以便 DDS 发现 |
| 音频 I/O | ALSA/PulseAudio → `sounddevice`（PortAudio）；或 GStreamer 管线 |
| AEC/降噪 | 首选麦克风阵列硬件 AEC；软件备选 `webrtc-audio-processing`（WebRTC APM：AEC3、NS、AGC） |
| VAD | Silero VAD（ONNX，CPU 友好） |
| 离线 KWS/命令词 | 候选 A：讯飞离线命令词识别 SDK（Linux，BNF 语法）⚠️ aarch64 版本需向讯飞确认；候选 B：sherpa-onnx 关键词识别（流式 Zipformer，中英，支持 aarch64 与 Jetson Orin NX，关键词改文本文件即可）✅ |
| TTS | 候选 A：讯飞离线语音合成 SDK（Linux）⚠️ aarch64 需确认；候选 B：云端讯飞在线 TTS 预合成 + 狗端缓存（常用应答语与喊话语全部预合成，断网也能播）；候选 C：开源 Piper/MeloTTS 本地兜底 |
| 对讲客户端 | 方案 C：`websockets`（Python asyncio）+ Opus 编解码（`opuslib`）；方案 B：TRTC 设备端 SDK（C） |
| MQTT | `paho-mqtt` 2.x（MQTT 5，mTLS，持久会话，离线队列落 SQLite） |
| 厂商桥 | 宇树：`unitree_sdk2_python`（CycloneDDS）/ `unitree_sdk2`（C++）；云深处：`x30_motion_sdk`（C++/Python）+ 厂商导航/巡检 API ⚠️ |
| 导航/巡检 | 调用厂商自带导航与巡检任务 API（Go2 EDU 可配 Nav2；X30 自带巡检系统）；本项目只做任务下发与状态回传 |
| GPIO | Jetson.GPIO（爆闪灯继电器、喊话器电源） |
| OTA | 签名的 compose 清单 + 镜像摘要；`ota-agent` 校验签名后滚动更新；失败自动回滚 |
| 测试 | pytest + `launch_testing`；硬件在环（HIL）台架：录音回放 + 噪声注入 |

#### 4.3.3 ROS 2 节点与话题（包名前缀 `dog_`）

| 节点 | 订阅 | 发布/服务 | 职责 |
|---|---|---|---|
| `dog_mqtt_bridge` | `/dog/state`, `/dog/alert`, `/dog/cmd_ack` | `/dog/cmd`（下行指令）、`/dog/tts_request`、`/dog/announce` | 与云端 MQTT 会话；离线队列；指令幂等与过期 |
| `dog_vendor_bridge` | `/dog/cmd` | `/dog/state`（电量、位置、姿态、任务）、`/dog/cmd_ack` | 封装 Go2/X30 SDK：`go_to`、`start_patrol`、`stop`、`return_home`、`follow`、`turn`、`speed` |
| `dog_audio_io` | — | `/audio/mic_frames`（16 kHz PCM）、服务 `play_pcm` | 麦克风阵列采集；扬声器播放；AEC 参考信号 |
| `dog_vad_kws` | `/audio/mic_frames` | `/dog/offline_intent` | VAD + 离线命令词；离线模式下直接发布到 `/dog/cmd`（本地闭环） |
| `dog_tts` | `/dog/tts_request`, `/dog/announce` | 调 `play_pcm` | 播报队列、防抖（同事件 N 秒内不重复）、语言包切换、预合成缓存 |
| `dog_intercom` | `/audio/mic_frames` | 调 `play_pcm` | PTT 对讲客户端（WS）；与 TTS 共用播放队列并抢占 |
| `dog_alarm_io` | `/dog/alert`, `/dog/announce` | — | 爆闪灯/喊话器电源 GPIO |
| `dog_event_ingest` | 厂商感知话题（人员闯入、异物、倾斜、测温） | `/dog/alert` | 事件规范化、截图/短视频/音频片段打包上传 |
| `dog_health` | 系统指标 | `/dog/state` | CPU/温度/网络 RSSI/链路；心跳 |

#### 4.3.4 离线命令词识别设计（D-12）

- 触发：`dog_mqtt_bridge` 检测云端不可达 ≥5 s → 发布 `offline=true`；`dog_vad_kws` 进入主动监听。
- 词表（可远程更新，但狗端有默认内置）：停下/站住/莫动/歇倒/Stop/Halt；回巢/回去充电/回基地/Return to base；跟我走/跟着我/Follow me；开始巡检/巡一圈/Start patrol。
- 防误触：需先说唤醒词（如「小铁小铁」）或连续两次置信命中；执行前 TTS 复述「离线模式：已停下」。
- 在线时 KWS 仍以「监听急停词」方式运行（只响应停下类），作为急停第二通道。
- 候选引擎评估标准（T-006）：aarch64 可用、CPU 占用 <1 核、唤醒误报 <1 次/小时（站场噪声录音回放）、召回 ≥95%。

### 4.4 第三方服务与 API（含「您需要做什么」）

#### 4.4.1 科大讯飞（需求书指定供应商）

| 接口 | 用途 | 端点 / 协议（核验） | 关键参数 | 配额与限制 |
|---|---|---|---|---|
| 语音听写大模型（中英）V2.0 | 小程序短指令识别（≤60 s） | `wss://iat.xf-yun.com/v1` ✅；鉴权：HMAC-SHA256 签 `host date request-line`，`authorization` Base64 放 query，`date` RFC1123 GMT，允许 ±300 s 偏差 ✅ | `parameter.iat`: `domain="slm"`, `language="zh_cn"`, `accent="mandarin"`（固定）, `dwa="wpgs"`（动态修正）, `ltc`（1 不过滤/2 仅中文/3 仅英文）, `eos`（静音超时 ms）, `dhw`（会话热词 `utf-8;词1|词2`，≤1024 字节）, `header.res_id`（控制台应用级热词）；音频 `encoding="raw"`，16 kHz/16 bit/单声道，1280 B/40 ms，`status` 0/1/2 ✅ | 默认并发按需求书 50 路（控制台确认）；单条 ≤60 s |
| 大模型多语种语音识别 | 英语模式（美式英语等） | `wss://iat.cn-huabei-1.xf-yun.com/v1` ✅（同一鉴权方式） | 语种参数以官方文档为准 ⚠️ | 同上 |
| 实时语音转写大模型 | 对讲长音频转写 | `wss://office-api-ast-dx.iflyaisol.com/ast/communicate/v1` ✅；鉴权：参数按名排序 urlencode 拼接后 HMAC-SHA1(accessKeySecret) + Base64 → `signature`；`appId`、`accessKeyId`、`utc` ✅ | `lang="autodialect"`（中英+202 方言）, `audio_encode="pcm_s16le"`（或 `opus-wb`）, `samplerate=16000`, `pd`（领域，可不设）, `eng_vad_mdn`（1 远场/2 近场）；结束发 `{"end":true}` ✅ | 默认 10 路（需求书）；单会话 ≤8 h；15 s 无音频断连；热词在控制台配置 ✅ |
| 离线命令词识别 SDK | 狗端断网兜底 | 控制台下载 Linux SDK（`libmsc.so`，BNF 语法编译）⚠️ aarch64 支持与装机授权需确认 | `engine_type=local`, `asr_res_path`, `grm_build_path`, `local_grammar` ⚠️ | 按装机量授权 |
| 离线语音合成 SDK / 在线 TTS | 狗端播报 | 在线：`tts-api.xfyun.cn/v2/tts`（备用、预合成）；离线：Linux SDK ⚠️ | 发音人、语速、音量 | 预合成可大幅降低在线调用量 |

**您需要做什么（讯飞）**：

1. 在讯飞开放平台（xfyun.cn）注册企业账号并完成企业实名认证。
2. 创建应用，取得 **AppID / APIKey / APISecret**（听写大模型、多语种识别、在线 TTS 共用）；实时转写大模型会单独给 **accessKeyId / accessKeySecret**。
3. 分别开通：语音听写大模型（中英）、大模型多语种语音识别（如需英语）、实时语音转写大模型、方言识别大模型（独立购买产品，联系商务确认并发与报价）、离线命令词识别 SDK、离线语音合成 SDK（询问 aarch64/嵌入式版本）。
4. 在控制台上传铁路术语热词（巡检、禁区、道岔、股道、车挡、法兰、溜逸、侵限…），记录 `res_id`。
5. 把密钥通过 Paperclip 的密钥托管（或云端 KMS）交给开发团队，**不要**贴在聊天、文档或代码里。
6. 商务：谈「中文+方言+英语」多语种套餐与并发扩容（听写 50 路 → 按规模；转写 10 路 → 按对讲路数）。

#### 4.4.2 微信

| 能力 | 用途 | 要求（核验） | 您需要做什么 |
|---|---|---|---|
| 小程序主体 | 承载小程序 | 企业主体（建议用铁路站段或项目公司主体）；选择类目（建议「工具 → 办公/效率」或与硬件相关类目，便于后续开通实时音视频）✅ | 注册小程序、企业认证（300 元/年认证费）、选类目 |
| 服务器域名 | API 与 WSS | 域名已 ICP 备案 + 可信证书；在「开发管理 → 服务器域名」登记 request/socket/uploadFile/downloadFile 合法域名 ✅ | 购买域名、完成 ICP 备案（需要企业资质，约 1～3 周）、申请证书 |
| 登录 | 身份 | `wx.login` → 后端 `code2Session` 取 `openid` | 把 AppID/AppSecret 交给开发团队（密钥托管） |
| 订阅消息 | 告警离线通知 | 在后台配置订阅消息模板（告警类） | 申请模板 |
| 实时音视频组件（方案 B） | 全双工对讲 | `live-pusher`/`live-player` 仅特定类目、企业主体；在「接口设置」自助开通 ✅ | Phase 0 尝试开通；不成功则维持方案 C |
| 设备音视频通话（方案 A） | 备选 | `wx.requestDeviceVoIP`（2.27.3+）、微信硬件平台注册型号与 SN ✅ | 仅在加装 Android 板时考虑 |
| `miniprogram-ci` | 自动上传 | 后台生成上传密钥，配置 IP 白名单 | 生成密钥交给 DevOps |

#### 4.4.3 企业微信 / 钉钉群机器人

| 平台 | 接口 | 限制（核验） | 您需要做什么 |
|---|---|---|---|
| 企业微信群机器人 | `POST https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=KEY`，`msgtype` 为 `text`/`markdown`/`image`/`news`/`template_card` | 每个机器人 20 条/分钟 ✅ | 在值班群、调度群各添加机器人，把 Webhook Key 交密钥托管 |
| 钉钉自定义机器人 | `POST https://oapi.dingtalk.com/robot/send?access_token=TOKEN&timestamp=...&sign=...`，加签 HMAC-SHA256(`timestamp\nsecret`) Base64 后 urlencode | 每个机器人 20 条/分钟，超限限流 10 分钟 ✅ | 创建机器人，启用「加签」，交 access_token 与 secret |

#### 4.4.4 云厂商与地图

- 开发/试点：腾讯云（广州或上海区域）：CVM/TKE、CLB、TencentDB for PostgreSQL、Redis、COS、CLS（可选）、SSL 证书、DNS；可选 TRTC。您需要：开通企业账号、实名、开通上述产品、给 DevOps 子账号最小权限。
- 地图：腾讯位置服务（小程序 `map` 组件默认）— 申请开发者 Key（WebServiceAPI 用于逆地理编码，可选）。
- 生产：铁路局机房资源（3 台以上服务器、内网域名、国密证书、镜像仓库），由业主协调。

#### 4.4.5 可选 LLM（意图兜底）

- 仅在词库匹配置信度 <0.7 时调用，输出受限 JSON（意图枚举 + 槽位），且必须经用户确认后才执行 —— 永不直接触发移动类指令。
- 国内可选：讯飞星火（与讯飞同一账号体系）、阿里云百炼（通义千问）、DeepSeek。建议试点阶段**关闭**，等词库成熟后再评估开启。
- 您需要做什么：若决定启用，开通所选平台账号并提供 API Key（密钥托管）。

### 4.5 开发环境与工具链

| 类别 | 工具 | 版本/说明 |
|---|---|---|
| 仓库 | 单一 monorepo（Git），托管于 GitHub 私有仓库或 Gitee 企业版（国内访问快）；分支策略 trunk-based + 短期特性分支 + PR | 目录结构见 §8.1 |
| 包管理 | pnpm 9 + Turborepo | `apps/*`、`packages/*`、`edge/*`、`infra/*` |
| Node | 24 LTS（`.nvmrc`/Volta 锁定） | |
| Python | 3.10（Jetson/ROS 2 Humble 约束）；`uv` 管理虚拟环境与锁文件 | `edge/` 下 |
| ROS 2 | Humble；开发机用 Docker 镜像 `ros:humble`（x86_64）+ 交叉验证 arm64 镜像（QEMU/buildx） | |
| 小程序 | 微信开发者工具（最新稳定版）+ `miniprogram-ci` + `miniprogram-automator` | 真机调试必需（录音/WS/音频） |
| 代码规范 | ESLint（typescript-eslint）、Prettier、Ruff（Python）、Black、clang-format（C++） | 提交前 `lint-staged` |
| 测试 | Vitest、Supertest、Testcontainers、Playwright、pytest、launch_testing、k6 | 覆盖率门槛 80% |
| 容器 | Docker 26+、`docker buildx`（多架构） | |
| 本地编排 | Docker Compose：postgres、redis、emqx、minio、gateway、admin、mock-xfyun | 一条命令起全栈 |
| 模拟器 | `mock-xfyun`（复现听写/转写协议，含动态修正与错误码）、`dog-sim`（虚拟狗：订阅 MQTT、回 ack、发遥测、可注入告警） | 无硬件也能跑 E2E |
| 可观测 | Prometheus、Grafana、Loki、Tempo（OTel）| 开发环境即启用 |
| 密钥 | `.env` 仅本地；CI 用仓库 Secrets；生产用 KMS/Vault；Paperclip 密钥托管用于 Agent 运行 | 见 §11.1 |
| 文档 | Markdown in repo（`docs/`）、ADR（架构决策记录）、OpenAPI/AsyncAPI 自动生成 | |
