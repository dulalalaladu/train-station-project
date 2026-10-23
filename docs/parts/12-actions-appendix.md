
---

## 12. 业主行动清单与附录

### 12.1 您需要做的事（按紧急程度）

**A. 现在就要决定（影响架构，建议 3 个工作日内）**

| # | 决定事项 | 本文默认 | 您的选择 |
|---|---|---|---|
| Q-01 | 首发场景 | 货场巡检（东昌站） | ☐ 同意 ☐ 改为：____ |
| Q-02 | 对接单位 | 站段（运维巡检为主） | ☐ 同意 ☐ 改为：____ |
| Q-03 | 小程序形态 | 微信小程序；离线指令在狗端 | ☐ 同意 ☐ 独立 App |
| Q-04 | 机器狗平台 | 原型 Go2 EDU；试点 X30 级 | ☐ 同意 ☐ 改为：____ |
| Q-06 | 网络 | 原型/试点 5G CPE + Wi-Fi 6 Mesh；生产专网 | ☐ 同意 ☐ 改为：____ |
| Q-07 | 云部署 | 试点腾讯云国内区域；生产铁路局私有化 | ☐ 同意 ☐ 改为：____ |
| D-05 | 对讲 | 先半双工 PTT，后评估 TRTC | ☐ 同意 ☐ 必须 WebRTC 全双工 |
| D-08 | LLM 兜底 | 默认关闭 | ☐ 同意 ☐ 开启（选平台：星火/千问/DeepSeek） |
| 时间线 | §1.6 建议 26 周 | — | ☐ 同意 ☐ 调整为：____ |

**B. 账号与资质（第 1 周启动，多数有审核周期）**

| # | 事项 | 平台 | 产出物（交给项目的内容） | 备注 |
|---|---|---|---|---|
| B-1 | 讯飞开放平台企业账号、实名、创建应用 | xfyun.cn | AppID / APIKey / APISecret（通过密钥托管） | 开通：语音听写大模型（中英）、大模型多语种识别、实时语音转写大模型、方言识别大模型、离线命令词 SDK、离线合成 SDK、在线 TTS |
| B-2 | 讯飞商务 | 讯飞销售 | 多语种套餐报价、并发（听写/转写）、私有化选项、aarch64 离线 SDK 可用性答复 | 需求书 R-10.3 |
| B-3 | 微信小程序注册 + 企业认证 + 类目选择 | mp.weixin.qq.com | AppID / AppSecret；类目截图 | 认证 300 元/年；类目尽量选能开通实时音视频的 |
| B-4 | 域名购买 + ICP 备案 + SSL 证书 | 域名商 / 工信部备案 / CA | 备案号、证书 | 备案 1～3 周；小程序服务器域名硬性要求 |
| B-5 | 小程序后台配置 | mp.weixin.qq.com | 服务器域名（request/socket/upload/download）、订阅消息模板 ID、`miniprogram-ci` 上传密钥与 IP 白名单、尝试开通 `live-pusher/live-player` | 由 A-7/A-2 提供具体值 |
| B-6 | 腾讯云企业账号 + 子账号 | cloud.tencent.com | 子账号 AK/SK（最小权限，密钥托管） | 开通 CVM/TKE、CLB、PostgreSQL、Redis、COS、证书、DNS；可选 TRTC |
| B-7 | 企业微信值班群/调度群机器人；钉钉机器人（加签） | 企业微信 / 钉钉 | Webhook Key / access_token + secret（密钥托管） | 每个机器人 20 条/分钟 |
| B-8 | 腾讯位置服务开发者 Key | lbs.qq.com | Key | 地图组件 |
| B-9 | （可选）LLM 平台账号 | 星火/百炼/DeepSeek | API Key | 仅当 D-08 选择开启 |
| B-10 | 代码托管组织（GitHub 私有 / Gitee 企业版） | — | 组织与仓库权限 | Agent 需要推送权限 |

**C. 采购与现场（第 1～2 周下单）**

| # | 事项 | 说明 |
|---|---|---|
| C-1 | 宇树 Go2 EDU（含 Jetson Orin NX）1 台（原型） | 或借用现有设备 |
| C-2 | 音频套件：USB 麦克风阵列（带 AEC）、D 类功放 + 号角喇叭（≥100 dB）、USB 声卡、线材 | 按 T-013 BOM |
| C-3 | 爆闪灯 + 继电器模块；5G CPE/工业路由 + SIM；移动电源/电源适配 | |
| C-4 | 云深处 X30（或同级）采购/租赁计划（试点） | 向厂商索取：SDK、导航/巡检 API 文档、计算单元规格、ROS 2 支持说明 |
| C-5 | 东昌站现场：勘测许可、网络条件资料、作业安全规范、天窗时段、对接人 | T-301 |
| C-6 | 方言语料采集：组织 ≥3 人/方言的作业人员配合录音并签署知情同意 | T-011/T-302 |

**D. 项目治理**

- 指定业主侧技术对接人、安全/合规对接人、现场对接人。
- 批准 Paperclip 中 A-1～A-7 七个 Agent 的雇佣申请（已随本策划书提交）。
- 每个 Phase 出口参加评审并签字。

### 12.2 附录 A：需求追踪矩阵（初版，由 A-6 维护）

| 需求 | 设计章节 | 任务卡 | 测试/验证 |
|---|---|---|---|
| R-4.1 选型 | §4.4.1 | T-003 | 联调报告 |
| R-4.2 语言策略 | §7.1, §7.4 | T-104, T-201, T-208 | KPI-05、FR-02 用例 |
| R-4.3 接口规格 | §4.4.1, §7.2 | T-003, T-103 | 契约/集成测试 |
| R-4.4 兜底 | §7.3 | T-104, T-106 | FR-04/05 用例 |
| R-4.5 性能 | §3.3, §10.3 | T-113, T-401 | KPI-01～04 |
| R-4.6 离线 | §3.6, §4.3.4 | T-006, T-110 | KPI-09 |
| R-5.1～5.3 小程序 | §4.1.1, §6.2 | T-005, T-106, T-201, T-202, T-206 | 真机 E2E |
| R-6.1～6.4 机器狗 | §4.3, §7.6 | T-108～T-110, T-205, T-211 | HIL/实机 |
| R-7.x 词库与剧本 | §7.3, 附录 D | T-009, T-104, T-208 | KPI-03 |
| R-8 技术架构 | §3 | 全部 | — |
| R-9 性能指标 | §10.3 | T-401 | KPI-01～10 |
| R-10 合规 | §11.1 | T-010, T-012, T-209, T-214, T-306 | 核查报告 |
| R-11 里程碑 | §8.2 | — | 出口评审 |
| R-12 待确认 | §2.4, §12.1 | T-014 | 业主确认 |

### 12.3 附录 B：术语表

| 术语 | 含义 |
|---|---|
| ASR | 自动语音识别（讯飞听写/转写） |
| KWS | 关键词识别（狗端离线命令词） |
| TTS | 语音合成 |
| AEC / NS / AGC | 回声消除 / 噪声抑制 / 自动增益 |
| VAD | 语音活动检测 |
| PTT | 一键通话（按住说话的半双工对讲） |
| 三元组 | 中文主指令 + 方言口语别名 + 英文等价词 |
| 置信度 | 意图匹配可信程度，<0.7 需用户确认 |
| 急停 | STOP 类意图，优先级 0，双通道 |
| mTLS | 双向 TLS，设备用证书认证 |
| 国密 | SM2/SM3/SM4 商用密码算法 |
| HIL | 硬件在环测试 |
| ADR | 架构决策记录 |

### 12.4 附录 C：参考资料（核验来源）

- 讯飞 语音听写大模型（中英）接口文档：https://www.xfyun.cn/doc/spark/spark_zh_iat.html
- 讯飞 大模型多语种语音识别：https://www.xfyun.cn/doc/spark/spark_mul_cn_iat.html
- 讯飞 实时语音转写大模型：https://www.xfyun.cn/doc/spark/asr_llm/rtasr_llm.html
- 讯飞 语音识别大模型产品页：https://www.xfyun.cn/services/speech_big_model
- 微信 `wx.requestDeviceVoIP`：https://developers.weixin.qq.com/miniprogram/dev/api/open-api/device-voip/wx.requestDeviceVoIP.html
- 微信 `wx.join1v1Chat`：https://developers.weixin.qq.com/miniprogram/dev/api/media/voip/wx.join1v1Chat.html
- 微信 RecorderManager / WebAudioContext：https://developers.weixin.qq.com/miniprogram/dev/api/media/recorder/RecorderManager.start.html 、https://developers.weixin.qq.com/miniprogram/dev/api/media/audio/wx.createWebAudioContext.html
- 腾讯云 TRTC 小程序：https://cloud.tencent.com/document/product/647/116548
- 宇树 unitree_sdk2_python：https://github.com/unitreerobotics/unitree_sdk2_python ；社区 WebRTC 驱动：https://github.com/legion1581/go2_webrtc_connect
- 云深处 x30_motion_sdk：https://github.com/DeepRoboticsLab/x30_motion_sdk
- sherpa-onnx（关键词识别，支持 aarch64/Jetson）：https://github.com/k2-fsa/sherpa-onnx
- 交通运输部《交通运输数据安全管理办法》（交科技规〔2026〕3 号）：https://xxgk.mot.gov.cn/
- RFC 8998 ShangMi Cipher Suites for TLS 1.3：https://www.rfc-editor.org/rfc/rfc8998
- EMQX 文档：https://docs.emqx.com/ ；NestJS：https://docs.nestjs.com/ ；Prisma：https://www.prisma.io/docs ；ROS 2 Humble：https://docs.ros.org/en/humble/

### 12.5 附录 D：词库种子（摘自需求书第七章，JSON 版见 `docs/seed/command-lexicon.v1.json`）

| 意图 | 中文主指令 | 方言/口语别名 | 英文等价 | 狗端动作 | 应答（中/英） | 最低角色 | 优先级 |
|---|---|---|---|---|---|---|---|
| GO_TO | 去 {点} | 去 {点} 嘛 / 到 {点} 那儿 | Go to point {点} | 自主导航至 {点} | 收到，前往 {点} / Heading to {点} | 执勤 | 5 |
| START_PATROL | 开始巡检 | 开始巡一圈 / 去巡检 | Start patrol | 执行预设巡检路线 | 巡检开始 / Patrol started | 执勤 | 5 |
| STOP | 停下 | 歇倒 / 莫动 / 站住 / 别动 / 停 | Stop / Halt | 平滑停止 | 已停下 / Stopped | 普通人员* | 0 |
| RETURN_HOME | 回巢 | 回去充电 / 回基地 | Return to base | 返回充电点 | 正在返回基地 / Returning to base | 执勤 | 4 |
| FOLLOW_ME | 跟我走 | 跟着我 / 随我走 | Follow me | 跟随人员 | 跟上你了 / Following you | 执勤 | 5 |
| TURN | 左转 / 右转 | 往左拐 / 朝右 | Turn left / Turn right | 转向 | 左转 / 右转 · Turning left/right | 执勤 | 5 |
| SPEED | 加速 / 减速 | 快点 / 慢点 | Speed up / Slow down | 调整速度 | 已加速 / 已减速 · Speeding up / Slowing down | 执勤 | 5 |
| QUERY_BATTERY | 电量多少 | 还有多少电 | Battery level | 读取电量 | 当前电量 {n}% / Battery at {n}% | 普通人员 | 7 |
| QUERY_STATUS | 状态如何 | 现在在干啥 | Status | 播报任务与状态 | （模板） | 普通人员 | 7 |
| QUERY_LAST_ALERT | 上次告警 | 刚才报的啥 | Last alert | 复述最近告警 | （模板） | 普通人员 | 7 |
| QUERY_LOCATION | 你在哪 | 你在哪儿 / 你到哪了 | Where are you | 播报位置 | 我在 {股道/点} / I am at {…} | 普通人员 | 7 |
| ANNOUNCE_RESTRICTED | 禁区警示 | — | Restricted area warning | 播放喊话 + 爆闪 | 禁区有人闯入，请注意 / Unauthorized person in restricted area | 执勤 | 3 |
| ANNOUNCE_CROWD | 客流疏导 | — | Crowd guidance | 播放喊话 | 前方列车即将进站，请退到安全线内等候 | 执勤 | 6 |
| ANNOUNCE_ANTI_FRAUD | 反诈宣传 | — | Anti-fraud notice | 播放喊话 | 陌生来电别轻信，官方渠道才安心，购票认准 12306 | 执勤 | 8 |
| ANNOUNCE_BELONGINGS | 保管物品提示 | — | Belongings notice | 播放喊话 | 请保管好随身物品，防止遗失 | 执勤 | 8 |

\* STOP 对所有角色开放（安全优先），其余移动类指令需执勤及以上。

告警类（狗端主动，需求书 7.3）：

| 触发 | 类型 | 中文 | 英文 | 推送对象 | 默认级别 |
|---|---|---|---|---|---|
| 人员闯入禁区 | intrusion | 禁区有人闯入，请注意 | Unauthorized person in restricted area | 小程序 + 值班群 | 紧急 |
| 货物倾斜/遮挡消防设施 | tilt / fire_block | 货场 {区} 货物倾斜，遮挡消防栓 | Cargo tilted in zone {区}, blocking hydrant | 小程序 + 值班群 | 重要 |
| 轨道异物 | track_obstacle | 检测到轨道异物，位置见推送 | Obstacle detected on track | 小程序 + 调度群 | 紧急 |
| 电量低于阈值 | low_battery | 电量低，正在返回基地 | Low battery, returning to base | 小程序 | 提示 |

### 12.6 附录 E：消息示例

```json
// 小程序 → 网关
{"type":"asr.start","session_id":"s_01J...","lang_mode":"zh_auto","robot_id":"dog-GO2-0001"}
// 网关 → 小程序（中间结果，动态修正）
{"type":"asr.partial","session_id":"s_01J...","text":"歇倒","pgs":"rpl","rg":[0,1]}
// 网关 → 小程序（意图）
{"type":"nlu.result","session_id":"s_01J...","intent":"STOP","canonical_text":"停下","confidence":0.96,
 "slots":{},"candidates":[{"intent":"STOP","confidence":0.96}],"requires_confirmation":false,"dialect_tag":"四川话(推测)"}
// 小程序 → 网关（提交）
{"type":"cmd.submit","command_id":"01J...","robot_id":"dog-GO2-0001","intent":"STOP","slots":{},"source":"voice","confirmed":true,"session_id":"s_01J..."}
// 网关 → 狗（MQTT dog/dog-GO2-0001/cmd/urgent）
{"command_id":"01J...","intent":"STOP","slots":{},"priority":0,"issued_at":"2026-10-23T03:10:00Z","expires_at":null,
 "reply_text_zh":"已停下","reply_text_en":"Stopped","lang_mode":"zh_auto"}
// 狗 → 网关（MQTT dog/dog-GO2-0001/up/ack）
{"command_id":"01J...","state":"done","ts":"2026-10-23T03:10:00.420Z","source":"cloud"}
// 狗 → 网关（告警）
{"alert_local_id":"a-77","type":"intrusion","severity_hint":"critical","pos":{"x":123.4,"y":56.7,"frame":"station:DCZ"},
 "zone_hint":"restricted-07","media":[{"kind":"photo","object_key":"alerts/2026/10/23/a-77.jpg"}],"audio_key":"alerts/2026/10/23/a-77.opus","ts":"..."}
```

---

*文档结束。本策划书由项目总负责人 Agent 编制并对其中的技术判断负责；所有标注 ⚠️ 的事项将在 Phase 0 验证后更新为 ✅ 或触发决策变更申请。*
