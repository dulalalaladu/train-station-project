# dog_vendor_bridge 接口契约 v1.0.0

适用：宇树 Go2 EDU（原型）、云深处 X30 级（试点/生产）及后续任何平台。
依据：实施策划书 §3.4/§3.6/§4.3.3、决策 D-03/D-04/D-11；能力盘点与实现路径见 [`docs/adr/0007-vendor-bridge.md`](../../../../docs/adr/0007-vendor-bridge.md)。
实现：`dog_vendor_bridge/vendor_bridge_base.py`（抽象基类）、`models.py`（pydantic 模型）、`fake_bridge.py`（假桥）。

## 1. 硬性规则

1. **厂商 SDK 只允许出现在本包的具体桥里**（`unitree_go2_bridge.py`、`deeprobotics_x30_bridge.py`，由 T-108 / T-211 实现）。基类、模型、其他 `dog_*` 包不得 import 任何厂商库。
2. 其他节点只依赖 `VendorBridgeBase` 与 `models.py`；ROS 2 节点 `dog_vendor_bridge`（T-107/T-108）是它的薄封装：订阅 `/dog/cmd` 与 `dog/<id>/cmd/urgent`、发布 `/dog/state` 与 `/dog/cmd_ack`。
3. 契约层不含 ROS 依赖，可在 CI 里纯 Python 测试（Python ≥3.10，pydantic v2）。
4. 所有模型不可变（frozen）、禁止多余字段（`extra="forbid"`）；跨边界输入先过 pydantic。
5. 错误信息会发布到云端：**不得**含密钥、原始载荷、IP/凭据。未预期异常一律映射为 `INTERNAL`，细节只写日志。

## 2. 动作接口

| 方法 | 入参 | 语义 | 任务 | 抢占 |
|---|---|---|---|---|
| `go_to` | `GoToCommand(target: Waypoint, speed_limit_mps?)` | 前往已解析好的点位 | 是 | 是 |
| `start_patrol` | `StartPatrolCommand(route_id, waypoints? \| vendor_route_ref?, loop)` | 执行预设路线（至少给点序列或厂商路线引用之一） | 是 | 是 |
| `return_home` | `ReturnHomeCommand(home?)` | 回充电/基地点；`home=None` 用厂商自带充电点 | 是 | 是 |
| `follow` | `FollowCommand(target_distance_m=1.5)` | 跟随人员；用 `stop` 结束 | 是 | 是 |
| `turn` | `TurnCommand(direction, angle_deg=90)` | 原地转向指定角度（≤180°） | 是（短任务） | 是 |
| `speed` | `SpeedCommand(change \| level)` | 调整速度档位；**设置而非任务** | 否 | 否（不打断当前任务） |
| `stop` | `mode: StopMode = SOFT` | 见 §4 | — | 取消一切 |

`Waypoint` 由调用方（`dog_mqtt_bridge` 依据云端 `waypoints` 配置）解析成 `station_local` 坐标 + 可选 `vendor_ref`（如 X30 的建图点编号）；桥**不**查表、不持有站场数据。坐标系转换（站场局部坐标 ↔ 厂商地图/里程计坐标）是具体桥的职责，在 ADR-0007 §5 登记为开放项。

每个动作返回 `ActionResult(command_id, kind, accepted, error?, latency_ms)`：
`accepted=True` 仅表示**厂商已受理并开始执行**（对应云端 `executing`），不表示完成。完成情况通过任务状态获得（§5）。

`capabilities() -> {ActionKind: Support}`（`full / partial / unsupported`）由类常量 `CAPABILITIES` 声明，必须覆盖全部 7 个 `ActionKind`，否则子类定义时抛 `TypeError`。`unsupported` 的动作在到达厂商之前就以 `NOT_SUPPORTED` 拒绝；`partial` 的限制写在具体桥的文档字符串与 ADR 矩阵里。

## 3. 任务模型

- **同一时刻至多一个运动任务**（`go_to / start_patrol / return_home / follow / turn`）。新的运动动作通过准入后**抢占**当前任务：旧任务置 `CANCELLED`（通知监听器），桥调用 `_do_cancel_task(旧 id)`（默认 = 软停），再启动新任务。抢占一旦通过准入即已生效；若新动作随后启动失败，旧任务不会恢复。
- 准入检查按顺序：`CAPABILITIES[kind] != UNSUPPORTED` → 桥已连接。`stop` 不做准入，任何状态下都尝试发送。
- 启动钩子 `_do_*` 必须**启动**动作后尽快返回（不得阻塞到动作完成），并在 `accept_timeout_s`（默认 2 s）内返回；长时运动由具体桥自己的线程/回调推进，完成时调用 `_complete_task(task_id, phase, error?)`。钩子内的长循环必须观察 `ctx.cancelled`。
- 任务状态 `TaskState(task_id=command_id, kind, phase, error?)`；`PENDING`（内部）→ `RUNNING` → `SUCCEEDED / FAILED / CANCELLED`。`add_task_listener(cb)` 在 `RUNNING` 与任一终态时回调（在锁外、可能来自任意线程；回调抛异常被记录并吞掉，不影响桥）。
- 终态只能进入一次；对未知或已终结 `task_id` 的迟到完成回调被忽略。

## 4. STOP 优先级语义（本契约最重要的部分）

D-11 / §9.3：`stop` 是独立的最高优先级通道，**≤100 ms**，不受任何其他动作、导航任务、播报队列阻塞。基类用下列机制强制实现，具体桥**不能**覆盖 `stop()`（定义子类时 `TypeError`），只实现 `_do_stop(mode)`：

1. **不取动作锁**：`stop()` 只短暂取一个内部状态锁（锁内不做任何厂商调用），因此不会排在慢动作后面。
2. **每次调用独立线程、无队列**：`_do_stop` 在新建的守护线程中执行并最多等待 `stop_budget_s`（默认 0.100 s）。上一个 `_do_stop` 挂死不会拖住下一个。
3. **先取消、后下发**：进入 `stop()` 即递增 `epoch`，当前活动任务立刻置 `CANCELLED` 并通知。
4. **启动中的竞态**：若某个动作的启动钩子在 STOP 期间才返回，该动作被判定为 `PREEMPTED_BY_STOP`（`accepted=False`），且基类会再补发一次软停——保证"STOP 之后不会有动作悄悄跑起来"。STOP 之后到达的新动作正常受理（STOP 不是锁死状态）。
5. **超时即报告**：`_do_stop` 超过预算 → `StopResult(ok=False, within_budget=False, error=TIMEOUT, result_unknown=True)`，调用方必须当作"未确认停止"处理（上报云端失败并告警；硬件急停/遥控器是最后防线）。调用不会被挂死的厂商调用拖住。
6. **模式**：`SOFT`＝平滑减速到站立停住（Go2 `StopMove`；X30 取消导航任务/速度归零）；`HARD`＝立即阻尼（Go2 `Damp`，机体可能趴下）。默认 `SOFT`。`BridgeConfig.escalate_stop_to_hard`（默认 **False**）为真时，软停失败/超时会自动再试一次 `HARD`——这是安全策略，开启需 A-0/业主决定（ADR-0007 开放问题 Q-A）。
7. **`within_budget`**：仅当 `ok` 且耗时 ≤ 预算才为真；失败的停止永远不算"预算内"。
8. 度量口径：`latency_ms` 衡量 `stop()` 入口到厂商停止命令被传输层受理；机体实际停住的时间由 HIL 台架另行测量（T-109/T-110/T-211，见 `docs/hardware/hil-rig.md`）。
9. 触发路径：云端 `dog/<id>/cmd/urgent`（独占线程、不经 `/dog/cmd` 排队）与本地 KWS（`dog_vad_kws`→停止请求）都直接调用同一个 `stop()`；`priority=0` 的 `/dog/cmd` 也走它。
10. `disconnect()` 先调用一次 `stop()` 再断开。

## 5. 状态结构

`get_state() -> RobotState`，受 `state_timeout_s`（默认 0.5 s）截止时间约束，厂商读取挂死也不会卡住调用者（超时按失败处理）；供 1 Hz 遥测与 `dog_health` 使用，弱网降 0.2 Hz 由上层控制：

| 字段 | 含义 | 说明 |
|---|---|---|
| `ts` | 墙钟时间（epoch s） | 由基类打戳 |
| `vendor`, `connected` | 平台标识、连接状态 | 状态读取失败时 `connected=False` 且 `faults` 含 `state_read_failed` |
| `mode` | `RobotMode`：idle/moving/navigating/patrolling/following/returning/charging/damped/fault/offline/unknown | 具体桥映射厂商运动状态 |
| `battery` | `soc_pct`(0–100)、`charging`、`voltage_v` | 未知填 `None`，不要编造 |
| `position` | `x_m,y_m,z_m,frame` | `frame` 如实标注（`station_local` / `vendor_odom` / `vendor_map`），上层决定能否上云 |
| `heading_deg`, `attitude` | 朝向与 roll/pitch/yaw（度） | |
| `speed_mps`, `speed_level` | 当前速度与档位 | |
| `localization_ok` | 定位是否有效 | X30 `location` 字段；Go2 无 SLAM 时为 `None` |
| `task` | 最近一个任务的 `TaskState` | 含终态，便于上层对账 |
| `faults` | 字符串故障码元组 | |

任务状态 → 云端 `up/ack`：`RUNNING`→`executing`，`SUCCEEDED`→`done`，`FAILED`→`failed`（带 `ErrorInfo`），`CANCELLED`→ 目前协议 §6.3 的 ack 枚举没有 `cancelled`，暂以 `failed` + `detail=cancelled` 上报，并已在 ADR-0007 登记为协议跟进项（A-1）。

## 6. 错误与超时语义

| `BridgeErrorCode` | 含义 | 典型来源 | 上层处理 |
|---|---|---|---|
| `NOT_SUPPORTED` | 平台缺口 | 能力为 unsupported，或钩子未实现 | 回云端 `failed`；不重试 |
| `NOT_CONNECTED` | 未连接/连接失败 | 准入、`connect()` | 重连后再试 |
| `TIMEOUT` | 厂商调用超时 | 启动超过 `accept_timeout_s`；停止超过预算 | `result_unknown=True`：先 `get_state()` 核对，再决定是否重发；启动超时时基类已补发软停 |
| `INVALID_ARGUMENT` | 参数厂商不接受 | 具体桥校验 | 不重试 |
| `VENDOR_FAULT` | 厂商返回失败 | 如 X30 `41746` 导航模块通信异常（`vendor_code`） | 依 `retryable` |
| `LOCALIZATION_LOST` | 定位丢失 | X30 `location=1` / `41747` | 上报告警，必要时人工介入 |
| `LOW_BATTERY` | 厂商因低电量拒绝 | X30 `41730` | 云端可转 `return_home` |
| `PREEMPTED_BY_STOP` | 启动期间被 STOP 取消 | 基类 | 终态，不重试 |
| `SUPERSEDED` | 被更新的运动命令取代 | 基类 | 终态 |
| `INTERNAL` | 桥自身异常 | 未捕获异常 | 记日志；消息不含异常细节 |

`ErrorInfo.result_unknown=True` 表示"厂商可能已经执行"。借鉴厂商平台 SDK 的做法：遇到未知结果，**先查询状态或等待事件，再决定是否重复下发**；写控制类操作不得无脑自动重试。

## 7. 线程与锁

- 公共方法线程安全，可从 ROS 2 多个回调组并发调用（urgent 回调应在独立的回调组/执行器线程）。
- 内部锁只保护字段，**绝不**跨越厂商调用持有。
- 厂商调用都带截止时间（启动 `accept_timeout_s`，停止 `stop_budget_s`，状态读取 `state_timeout_s`）；挂死的调用留在守护线程里直到厂商返回，不阻塞调用者。具体桥必须保证被遗弃的调用最终能返回（带传输层超时），避免线程泄漏。

## 8. 新增一个平台的清单

1. 子类化 `VendorBridgeBase`，设置 `VENDOR` 与覆盖全部 7 项的 `CAPABILITIES`，在 ADR-0007 矩阵里写明每项实现路径。
2. 实现 4 个抽象钩子：`_do_connect`、`_do_disconnect`、`_do_stop(mode)`、`_read_state`；按能力实现 `_do_*` 启动钩子；需要时覆盖 `_do_cancel_task`。
3. 不要覆盖 `stop()`；不要在钩子里阻塞到动作完成。
4. 复用 `fake_bridge.py` 的测试套路写契约测试（准入、抢占、超时、STOP 竞态），再上台架/实机，并把实测的 STOP 延迟记入 HIL 日志。
5. SDK 版本固定并记录（`requirements`/镜像 digest）；密钥/证书只来自环境变量或 Paperclip 密钥托管。

## 9. 与测试

`python -m pytest`（在包目录）运行 56 个用例：模型校验、动作路径、抢占、超时、STOP 预算/不被阻塞/竞态/升级、并发压力。覆盖率门槛 80%（`pyproject.toml` 强制，`fake_bridge.py` 作为测试替身不计入）。
