
---

## 6. 数据模型与协议规格

### 6.1 核心数据模型（PostgreSQL，Prisma schema 以此为准）

所有表带 `id`（UUID v7）、`created_at`、`updated_at`、`station_id`（多站预留）。敏感字段标 🔒（SM4 应用层加密）。

| 表 | 关键字段 | 说明 |
|---|---|---|
| `users` | `employee_no`、`name`、`role`（enum: worker/guard/dispatcher/admin）、`wx_openid`、`lang_mode`（zh_auto/zh_mandarin/en_us/zh_en_mixed）、`status` | 人员由后台导入；`wx_openid` 首次登录绑定 |
| `stations` | `code`、`name`、`timezone`、`map_asset_id` 🔒 | 站场 |
| `zones` | `station_id`、`type`（restricted/track/yard/platform/equipment_room）、`geom`（PostGIS polygon，站场局部坐标）🔒、`alert_policy_id` | 区域/禁区 |
| `waypoints` | `station_id`、`code`（如 `A`、`E-03`）、`name`、`aliases[]`（语音别名）、`pos`（PostGIS point）🔒 | 巡检点/目标点 |
| `patrol_routes` | `station_id`、`name`、`waypoint_ids[]`、`vendor_route_ref` | 预设巡检路线 |
| `robots` | `serial`、`vendor`（unitree_go2/deeprobotics_x30）、`station_id`、`cert_fingerprint`、`firmware`、`status`（online/offline/charging/fault）、`last_seen_at`、`home_waypoint_id` | 机器狗 |
| `robot_telemetry`（按天分区） | `robot_id`、`ts`、`battery_pct`、`pos`、`heading`、`posture`、`task`、`rssi`、`link`（5g/wifi/mesh）、`cpu_temp` | 遥测，默认保留 90 天 |
| `user_robot_grants` | `user_id`、`robot_id`、`level`（query/control） | 设备授权 |
| `intents` | `code`（STOP/GO_TO/START_PATROL/RETURN_HOME/FOLLOW_ME/TURN/SPEED/QUERY_BATTERY/QUERY_STATUS/QUERY_LAST_ALERT/QUERY_LOCATION/ANNOUNCE/…）、`category`（control/query/announce/system）、`min_role`、`priority`（0 急停 … 9 低）、`slots_schema`（JSON） | 意图定义 |
| `lexicon_entries` | `intent_code`、`lang`（zh/en/dialect:<name>）、`phrase`、`kind`（canonical/alias/english）、`source`（seed/admin/field）、`dialect_tag`、`status`（active/pending_review） | 三元组词库（一条意图多行） |
| `lexicon_versions` | `version`、`published_at`、`checksum`、`entries_snapshot`（JSONB） | 热更新版本；小程序与狗端按版本拉取 |
| `hotwords` | `phrase`、`weight`、`synced_to_xfyun_at`、`res_id` | 铁路术语热词 |
| `commands` | `command_id`（幂等键，由小程序生成 UUID）、`user_id`、`robot_id`、`intent_code`、`slots`（JSON）、`source`（voice/button/map/offline_kws/text）、`raw_text`、`normalized_text`、`dialect_tag`、`confidence`、`lang_mode`、`asr_session_id`、`state`（created/confirm_required/queued/received/executing/done/failed/cancelled/expired）、`priority`、`expires_at`、`state_history`（JSONB 带时间戳）、`audio_object_key` 🔒 | 指令与三级回执 |
| `asr_sessions` | `user_id`、`provider`（xfyun_slm/xfyun_mul/xfyun_rtasr/mock）、`lang_mode`、`started_at`、`ended_at`、`audio_ms`、`final_text`、`partials`（JSONB）、`xfyun_sid`、`error_code` | 计量与排障 |
| `intercom_sessions` | `user_id`、`robot_id`、`mode`（ptt/duplex）、`started_at`、`ended_at`、`recording_object_key` 🔒、`transcript`（JSONB，带时间戳与说话方） | 对讲 |
| `alerts` | `robot_id`、`type`（intrusion/tilt/fire_block/track_obstacle/low_battery/device_fault/custom）、`severity`（critical/major/minor）、`zone_id`、`pos` 🔒、`media`（JSONB: photo/video/audio object keys）、`message_zh`、`message_en`、`state`（new/acked/in_progress/closed/suppressed）、`dedupe_key`、`pushed_channels`（JSONB） | 告警 |
| `alert_policies` | `zone_id?`、`type?`、`severity`、`quiet_hours`、`dedupe_window_s`、`channels[]`、`auto_announce_id?`、`loop_interval_s?` | 策略 |
| `work_orders` | `alert_id`、`assignee_user_id`、`plan_ref`、`state`、`notes` | 一键转工单 |
| `announcements` | `code`、`text_zh`、`text_en`、`category`（restricted/crowd/anti_fraud/lost_found/custom）、`audio_zh_key`、`audio_en_key`、`version` | 喊话语句库（预合成音频引用） |
| `announce_schedules` | `robot_id`/`zone_id`、`announcement_id`、`cron`/`interval_s`、`active_window`、`enabled` | 循环播报 |
| `recordings` | `kind`（command/intercom/announce/alert_audio）、`object_key` 🔒、`codec`、`duration_ms`、`sha256`、`prev_hash`（哈希链）、`retention_until`、`ref_table`、`ref_id` | 录音留存 |
| `audit_logs` | `actor_type`（user/robot/system）、`actor_id`、`action`、`target`、`detail`（JSONB）、`ip`、`hash`、`prev_hash` | 审计（追加写） |
| `xfyun_quota_samples` | `ts`、`interface`、`concurrent`、`errors` | 配额监控 |

数据分级（依据《交通运输数据安全管理办法》三级框架，Phase 0 T-010 正式评定）：

- 重要/敏感（🔒 加密、仅调度员以上可导出）：站场平面图、`zones.geom`、`waypoints.pos`、`robot_telemetry.pos`、`alerts.pos`、录音。
- 一般 2 级：人员信息（工号、姓名、openid）、指令日志、告警文本。
- 一般 3 级：词库、喊话文本、配置。

### 6.2 小程序 ↔ 云端 WebSocket 协议（单连接多路复用）

连接：`wss://api.<domain>/ws?token=<jwt>`；心跳 `ping/pong` 15 s；所有消息为 JSON 文本帧，音频为二进制帧并带 4 字节前缀头。

二进制帧格式：`[channel:u8][flags:u8][seq:u16][payload PCM16LE 16 kHz]`，`channel` 1 = ASR 音频，2 = 对讲音频；`flags` bit0 = 末帧。

JSON 消息（`type` 字段为路由键；全部由 `packages/protocol` 的 zod schema 定义）：

| 方向 | type | 关键字段 | 说明 |
|---|---|---|---|
| ↑ | `asr.start` | `session_id`, `lang_mode`, `robot_id`, `hotword_hint?` | 开始一次语音指令；网关建立讯飞会话 |
| ↑ | (binary ch=1) | — | PCM 分片 |
| ↑ | `asr.end` | `session_id` | 松开按键 |
| ↓ | `asr.partial` | `session_id`, `text`, `dialect_tag?`, `pgs?`（apd/rpl）, `rg?` | 实时回显（动态修正） |
| ↓ | `asr.final` | `session_id`, `text`, `dialect_tag?`, `lang_detected` | 最终文本 |
| ↓ | `nlu.result` | `session_id`, `intent`, `canonical_text`, `confidence`, `slots`, `candidates[]`, `requires_confirmation` | 意图结果 |
| ↑ | `cmd.submit` | `command_id`(uuid), `robot_id`, `intent`, `slots`, `source`, `confirmed`, `raw_text?`, `session_id?` | 提交指令（含确认后的提交、快捷按钮、地图选点、文字兜底） |
| ↓ | `cmd.state` | `command_id`, `state`, `ts`, `detail?`, `robot_reply_text?` | 三级回执及失败原因 |
| ↑ | `cmd.cancel` | `command_id` | 取消 |
| ↓ | `robot.state` | `robot_id`, `battery_pct`, `pos`, `heading`, `posture`, `task`, `online`, `rssi`, `link`, `ts` | 节流 1 Hz |
| ↑ | `talk.start` / `talk.end` | `intercom_id`, `robot_id` | PTT 对讲 |
| ↕ | (binary ch=2) | — | 对讲音频（上行 PCM；下行 PCM） |
| ↓ | `talk.transcript` | `intercom_id`, `speaker`(user/robot), `text`, `final` | 字幕 |
| ↓ | `alert.new` / `alert.update` | `alert` 对象（见 6.1） | 告警推送 |
| ↑ | `alert.ack` | `alert_id` | 确认 |
| ↑ | `user.lang_mode` | `lang_mode` | 切换语言（≤1 s 生效，网关回 `user.lang_mode.ok` 并携带对应词库版本） |
| ↓ | `lexicon.version` | `version`, `url` | 词库热更新通知 |
| ↓ | `error` | `code`, `message`, `ref?` | 错误（如讯飞并发满 → `ASR_BUSY`，小程序提示稍后再说） |

### 6.3 云端 ↔ 机器狗 MQTT 主题与载荷

- Broker：EMQX，端口 8883（mTLS），MQTT 5，`clean_start=false`，`session_expiry=300 s`，心跳 30 s。
- 客户端 ID = `dog-<serial>`；ACL：只允许 `dog/<serial>/#`。
- 下行（云 → 狗）：

| 主题 | QoS | 载荷要点 |
|---|---|---|
| `dog/<id>/cmd` | 1 | `{command_id, intent, slots, priority, issued_at, expires_at, reply_text_zh, reply_text_en, lang_mode}`；`priority=0` 的急停另发 `dog/<id>/cmd/urgent`（狗端单独订阅、独占处理线程） |
| `dog/<id>/tts` | 1 | `{text_zh, text_en, lang, cache_key?, interrupt:boolean}` |
| `dog/<id>/announce` | 1 | `{announcement_id, loop:{interval_s, until}, lights:boolean, siren:boolean}` |
| `dog/<id>/config` | 1（保留消息） | 词表版本、喊话库版本、端点、策略、语言包 |
| `dog/<id>/ota` | 1 | 签名清单 |

- 上行（狗 → 云）：

| 主题 | QoS | 载荷要点 |
|---|---|---|
| `dog/<id>/up/ack` | 1 | `{command_id, state: received/executing/done/failed/expired, ts, detail?, source: cloud/offline_kws}` |
| `dog/<id>/up/state` | 0 | 遥测（1 Hz，弱网降到 0.2 Hz） |
| `dog/<id>/up/alert` | 1 | `{alert_local_id, type, severity_hint, pos, zone_hint, media:[{kind, object_key}], audio_key?, ts}` |
| `dog/<id>/up/log` | 0 | 结构化日志（分级） |
| `dog/<id>/up/health` | 0 | CPU/温度/磁盘/链路 |
| `dog/<id>/up/offline_replay` | 1 | 联网后补传的离线指令与事件 |

幂等与过期：狗端维护最近 1000 个 `command_id`；重复直接回 `done`（带 `duplicate=true`）；`expires_at` 早于当前时间的指令回 `expired` 不执行；急停不设过期。

### 6.4 REST API（管理后台与小程序非实时操作，节选）

| 方法 | 路径 | 角色 | 说明 |
|---|---|---|---|
| POST | `/api/v1/auth/wx-login` | 公开 | `code` → JWT（需已导入人员并首次绑定） |
| POST | `/api/v1/auth/refresh` | 登录 | 刷新 |
| GET | `/api/v1/me` | 登录 | 个人信息、语言偏好、授权设备 |
| PUT | `/api/v1/me/lang-mode` | 登录 | 切换语言（REST 兜底，WS 为主） |
| GET | `/api/v1/robots?station=` | 登录 | 可见设备及状态 |
| GET | `/api/v1/commands?robot=&from=&to=` | 登录 | 指令记录 |
| GET | `/api/v1/alerts?state=&severity=` | 登录 | 告警列表 |
| POST | `/api/v1/alerts/{id}/work-orders` | 执勤+ | 一键转工单 |
| GET | `/api/v1/waypoints?station=` | 登录 | 地图选点 |
| GET | `/api/v1/lexicon/versions/latest` | 登录 | 词库快照（小程序本地提示用） |
| CRUD | `/api/v1/admin/users`、`/robots`、`/zones`、`/waypoints`、`/intents`、`/lexicon`、`/hotwords`、`/announcements`、`/alert-policies`、`/announce-schedules` | 管理员 | 后台 |
| POST | `/api/v1/admin/lexicon/publish` | 管理员 | 生成新版本并广播热更新 |
| GET | `/api/v1/admin/recordings?...` / `GET /recordings/{id}/url` | 调度+ | 录音检索与限时下载链接（审计） |
| GET | `/api/v1/admin/xfyun/quota` | 管理员 | 并发与错误统计 |
| POST | `/api/v1/robot/media/presign` | 设备证书 | 狗端媒体直传预签名 |
| GET | `/healthz`、`/readyz`、`/metrics` | 内网 | 运维 |

统一响应信封：`{ success: boolean, data: T | null, error: { code, message } | null, meta?: { total, page, limit } }`。
