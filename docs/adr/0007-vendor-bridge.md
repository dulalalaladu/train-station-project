# ADR-0007 厂商桥：SDK 能力盘点、接口契约与实现路径

| 项目 | 内容 |
|---|---|
| 状态 | 提议，待 A-0 评审（Paperclip DOU-8 / 任务卡 T-007） |
| 日期 | 2026-10-23 |
| 作者 | A-3 机器狗端工程师 |
| 关联 | D-03、D-04、D-11；Q-04；RK-04、RK-10；§3.4、§3.6、§4.3；任务 T-108、T-211、T-013 |
| 契约 | [`edge/ros2_ws/src/dog_vendor_bridge/CONTRACT.md`](../../edge/ros2_ws/src/dog_vendor_bridge/CONTRACT.md) |
| 方法限制 | 本 spike **没有接触任何真机**，也没有下载任何 SDK 二进制；结论只来自厂商官方 GitHub 仓库的源码/README 与公开资料（2026-10-23 抓取）。凡未能核验处标 ⚠️，并列入 §8 的厂商问题清单 |

标记沿用策划书 §0.2：✅ 已对照官方一手资料核验；⚠️ 未核验/待实机；❗ 与策划书不一致。

## 1. 结论摘要

1. **Go2 EDU 适合做原型，但"导航类"动作要自己补**：官方运动 SDK 提供停止/阻尼、速度、姿态、避障开关与状态订阅 ✅，没有 go_to / 巡检 / 回充 / 跟随接口。`go_to`、`start_patrol`、`return_home` 需要在 Orin NX 上自带 SLAM + Nav2 实现（雷达点云话题可用性 ⚠️）；`follow` 是缺口。
2. **Go2 内置音频确无官方入口** ✅（D-04 成立）：Go2 SDK 的 `vui` 服务只有开关/音量/灯亮度六个接口，没有播放或采集；同一仓库里 G1 才有 `audio` 模块。外置麦克风阵列 + 功放是正确路线。
3. ❗ **策划书 §12.4 / §4.3.2 引用的 `DeepRoboticsLab/x30_motion_sdk` 当前已不可访问**（GitHub API 与 raw 均 404；该组织公开仓库列表里没有它）。能确认的公开 X30 接口是 **`robotserver_sdk`**（C++，MIT，导航任务级：状态/下发导航点/取消/查询）和 **智巡平台 `station-openapi-devkit`**（Java，28 个 HTTP 接口，需要平台）。二者都**不含**速度/转向/阻尼/跟随，也都不是 ROS 2。
4. **X30 的 `stop ≤100 ms`、`turn`、`follow` 目前没有公开依据**，是 RK-04 的实质性缺口，必须靠 C-4 向云深处书面索取（§8）。在得到答复前，X30 桥只能承诺"取消导航任务"，不能承诺 100 ms 停稳。
5. ❗ `robotserver_sdk` 官方明确**禁止安装在 106 导航主机或机器人其他主机上**，必须跑在**独立计算机**上。这意味着 X30 必须加装自备的载荷计算单元（Orin NX 级），不能把 SDK 塞进机器人自带主机——BOM 已据此编制（`docs/hardware/bom.md`）。
6. 契约（CONTRACT.md）已落地并有 56 个单元测试（假桥）；STOP 优先级由基类强制，具体桥无法覆盖。

## 2. 证据来源与版本记录

| 来源 | 版本 / 日期 | 说明 |
|---|---|---|
| `unitreerobotics/unitree_sdk2_python`（BSD-3-Clause） | `master`，最近推送 2026-09-21；**无 tag/release**；要求 Python ≥3.8、`cyclonedds==0.10.2` | 文件：`go2/sport/sport_api.py`、`sport_client.py`、`go2/vui/vui_api.py`、`go2/obstacles_avoid/*`、`example/` ✅ |
| `unitreerobotics/unitree_sdk2`（C++） | 最新 release `2.0.2`（2025-07-07） | 仅核对版本 ✅ |
| `unitreerobotics/unitree_ros2` | `master`；Humble 为推荐发行版 | README：话题 `lf/sportmodestate`、`lowstate`、`/api/sport/request` ✅ |
| `DeepRoboticsLab/robotserver_sdk`（MIT） | `main`，**唯一一次提交 2025-03-31**（"First Commit"） | 英文 README + `docs/en/api_reference.en.md` ✅ |
| `DeepRoboticsLab/station-openapi-devkit`（BSD-3-Clause） | 源码版本 `1.1.0`，2026-10-20 仍在更新 | README、quickstart、示例服务类 ✅ |
| `DeepRoboticsLab/deep-robotics-sdk2` / `deep-robotics-msg` | 2026-10-23 更新 | **仅 DR02 Pro/Std**（ROS 2 Humble/Jazzy），不含 X30 ✅ |
| `DeepRoboticsLab/x30_motion_sdk` | **404** | 策划书 §12.4 链接失效 ❗；搜索引擎摘要称其为关节级 SDK（pos/vel/kp/kd/tff，无指令 1 s 后回到阻尼保护，V1.0 2024-01、V2.0 2024-03 增 Python）——这是**二手信息 ⚠️** |
| RobotShop X30 Pro 页面；robostore Go2 EDU+ 页面 | 2026-10-23 抓取 | X30 Pro：IP67、4 h、负载 20 kg、4 m/s、RTK、一键急停、特价订购 138,600 USD；Go2 EDU+：Orin NX 16GB（100 TOPS）、2–4 h、2 m/s、负载 8 kg（最大 12）、内置 4D LiDAR L2，13,250 USD（页面缺货），IP 等级未标注 |
| 宇树文档中心 `support.unitree.com` | 抓取失败（前端渲染站点） | 参数取值范围 ⚠️ 未核验 |

固定策略：Go2 桥依赖 `unitree_sdk2_python` 的**固定 commit**（无 tag），与 `cyclonedds==0.10.2`；记录进 T-108 的镜像 digest。X30 桥依赖 `robotserver_sdk` 的固定 commit。二者都只从官方 GitHub 仓库获取源码，不使用任何第三方二进制。

## 3. 宇树 Go2 EDU

### 3.1 SDK 形态

- 通信：CycloneDDS 0.10.2；`ChannelFactoryInitialize(domain, "<网卡名>")` 指定接口 ✅。外接 PC 与机器人同属 192.168.123.0/24（官方 ROS 2 文档给出主机地址 192.168.123.99）✅；**机载 Orin NX 的地址与网卡名 ⚠️ 待实机确认**。
- Python：`unitree_sdk2_python`（≥3.8，兼容 Humble 的 3.10 ✅）。ROS 2 路径：`unitree_ros2`（Humble 直接使用 DDS 消息、无需单独编译 CycloneDDS ✅）。
- 选择：**桥使用 `unitree_sdk2_python`**（SDK 类型不进入 ROS 消息，满足 D-03）；`unitree_ros2` 的 `/api/sport/request` 作为备选路径。两个 CycloneDDS 栈（ROS 2 的 rmw 与 SDK 的）并存时必须各自限定网卡（`CYCLONEDDS_URI`）并把桥放进独立容器，避免 DDS 发现串扰 ⚠️ 需 T-107 验证。

### 3.2 运动接口（`SportClient`，服务 `sport` v1.0.0.1 ✅）

| 契约动作 | 厂商接口 | 备注 |
|---|---|---|
| `stop`（SOFT） | `StopMove()`（api 1003） | 软停 ✅ |
| `stop`（HARD） | `Damp()`（api 1001） | 电机阻尼，机体会趴下 ✅ |
| 站立/恢复 | `StandUp`(1004)、`StandDown`(1005)、`BalanceStand`(1002)、`RecoveryStand`(1006) | 开机/摔倒后用 ✅ |
| 速度 / 转向 | `Move(vx, vy, vyaw)`（api 1008） | **发送后不等待回复** ✅（调用即返回，无法从返回值得知是否执行）；速度范围、命令超时自停时间 ⚠️ |
| 速度档位 | `SpeedLevel(level:int)`（api 1015） | 档位含义 ⚠️ |
| 姿态 | `Euler(roll,pitch,yaw)`（1007） | |
| 避障 | `SwitchAvoidMode()`（2058）、`FreeAvoid(flag)`（2048） | |
| 自恢复 | `AutoRecoverySet/Get`（2054/2055） | |
| 其余 | 舞蹈、翻转、倒立等表演动作 | **契约不暴露**，桥里禁用 |

RPC 默认超时：官方示例 `SetTimeout(10.0)` ✅ ——停止路径必须使用**独立的 `SportClient` 实例并把超时调到 <100 ms**，且不得与 `Move` 循环共用线程/实例（见 §6）。RPC 往返实测延迟 ⚠️ 待 T-108 台架。

### 3.3 状态订阅

- `rt/sportmodestate`（ROS 2: `lf/sportmodestate` 低频版）✅：`mode`（0 idle、1 balanceStand、3 locomotion、5 lieDown、7 damping、8 recoveryStand…）、`gait_type`、`position[3]`、`velocity[3]`、`yaw_speed`、`body_height`、`range_obstacle[4]`、`imu_state`（姿态）、`error_code`、足端力/位置。
- `rt/lowstate`：`bms_state`（电池管理）、`power_v/power_a`、电机温度、`imu_state` ✅。SOC 字段名与单位 ⚠️ 待实机。
- ⚠️ `position` 的参考系（推测为上电里程计系，而非站场/地图系）；契约用 `frame="vendor_odom"` 如实标注，站场坐标由 Nav2 定位提供。

### 3.4 避障与导航（Nav2 可行性）

- ✅ `obstacles_avoid` 服务：`SwitchSet/Get`（1001/1002）、**`Move`（1003，带避障的速度控制）**、`UseRemoteCommandFromApi`（1004）。即 Nav2 的 `cmd_vel` 可经 `obstacles_avoid.Move` 下发，由厂商避障兜底。
- ✅ 官方无 go_to / 路径跟踪 / 巡检 / 回充 API（`SportClient` 40 个方法里没有）。
- 可行路径：Orin NX 上跑 LiDAR SLAM/定位（如 slam_toolbox 或 FAST-LIO）+ Nav2，`cmd_vel` → `obstacles_avoid.Move`。**前提 ⚠️：机载雷达点云能经 DDS 取得**（EDU 系列带 L1/L2 雷达，点云话题名与格式本 spike 未核验）。该路径属于"本项目自带导航"，与策划书 §2.5"导航算法本身不在范围"有张力：属 Go2 的补缺工作，**仅限原型**，不进入试点平台（X30 自带导航）。
- 估算负载：SLAM + Nav2 约占 2–3 个 CPU 核、1.5–3 GB 内存 ⚠️（见 §3.6）。

### 3.5 内置音频：无官方入口的证据 ✅

- Go2 SDK 的 `vui` 服务（`vui_api.py`）仅有 `SetSwitch/GetSwitch(1001/1002)`、`SetVolume/GetVolume(1003/1004)`、`SetBrightness/GetBrightness(1005/1006)`——开关、音量、灯亮度；示例 `vui_client` 也只循环调节音量与灯光。
- `unitree_sdk2py/go2/` 子包只有 `obstacles_avoid`、`robot_state`、`sport`、`video`、`vui`；而 `g1/` 有独立的 `audio` 模块。即 Go2 没有 TTS/播放/拾音客户端。
- 社区的 WebRTC 驱动（§12.4 `go2_webrtc_connect`）是非官方路径，**本项目不使用**。
- 结论：D-04（外置麦克风阵列 + 功放）成立，无需变更。

### 3.6 Jetson Orin NX 载荷资源占用（估算，非实测）⚠️

Go2 EDU 机载 Orin NX 8 GB（6 核）或 16 GB（8 核，100 TOPS；EDU+ 配置）。下表是设计预算，T-108/T-109 必须用 `tegrastats` 实测并回填：

| 负载 | CPU（核） | 内存 | 备注 |
|---|---|---|---|
| 厂商桥 + DDS 客户端 | ≤0.2 | ≤150 MB | 状态 1 Hz、停止独立线程 |
| 音频 I/O + VAD（Silero ONNX） | ≈0.2 | ≈200 MB | |
| 离线 KWS（sherpa-onnx，T-006 指标 <1 核） | <1 | ≈300 MB | |
| MQTT 桥 + 对讲（Opus/WS） + TTS 缓存播放 | ≈0.3 | ≈200 MB | |
| SLAM + Nav2（仅 Go2 补缺） | 2–3 | 1.5–3 GB | 8 GB 版本余量紧 |
| 合计 | ≈4–5 | ≈2.5–4 GB | 验收：稳态 CPU <70%、内存 <70%、温度不降频 |

建议原型采购 **16 GB（EDU+）**；8 GB 版只在不跑 Nav2 时可用。

## 4. 云深处 X30

### 4.1 公开接口全景

| 接口 | 形态 | 能做什么 | 不能做什么 |
|---|---|---|---|
| **`robotserver_sdk`**（MIT，C++17，Boost.Asio，XML 报文，TCP；示例连 `192.168.1.106:30000`）✅ | 运行在**独立计算机**上，连接机器人导航主机 | `1002` 实时状态；`1003` 下发导航点（异步，回调返回结果）；`1004` 取消导航任务（同步）；`1007` 查询任务状态 | 无速度/转向/站立/阻尼/跟随；无语音 |
| **智巡平台 Station OpenAPI**（`station-openapi-devkit` 1.1.0，Java 17 / Spring Boot 3，28 个 HTTP 接口，7 组：system/dog/task/taskTemplate/camera/inventory/result；RocketMQ 事件）✅ | 通过平台服务器间接控制机器人，需向技术支持索取 endpoint 与 AppKey/SecretKey 或 Token；平台 ≥1.3.3 才有任务模板启停 | `dog`：状态、**充电控制**、控制、设置/查询位置、告警分页；`task`：下发、控制、批量取消、分页 | 依赖平台部署；控制类接口需谨慎（SDK 示例默认锁定 11 个写/控制操作）；"控制"的具体语义/延迟 ⚠️ |
| `x30_motion_sdk` | 链接失效 ❗ | 二手信息：关节级控制 | 不是行走级高层接口 ⚠️ |
| ROS 2 | **公开资料无 X30 的 ROS 2 接口证据** ⚠️ | — | `deep-robotics-sdk2` 只覆盖 DR02；不能据此推断 X30 |

### 4.2 `robotserver_sdk` 细节 ✅

- `RealTimeStatus`（1002）：`motionState`、`posX/Y/Z`、`angleYaw`、`roll/pitch/yaw`、`speed`、里程与运行时长、`electricity`（电量）、`location`（0 定位正常 / 1 定位丢失）、`RTKState`、`onDockState`、`chargeState`、`gaitState`、`motorState`、`controlMode`、`mapUpdateState`。
- `NavigationPoint`（1003）：`mapId`、`value`（点编号）、`posX/Y/Z`、`angleYaw`、`pointInfo`、`gait`、`speed`、`manner`、`obsMode`、`navMode`、`terrain`、`posture`——**各整型字段的取值含义 README 未给出 ⚠️**（见 §8 DR-5）。
- 任务结果 `ErrorStatus` 里能看到平台内部能力：软急停/摔倒（41729、41766）、低电量（41730）、电机过温（41731）、导航进程未启动（41745）、定位持续异常 >30 s（41747）、**进入/退出自主充电**（41794–41797）、重定位（41881/41798）、**上位机连接断开自动停止任务（41802）**、全局规划失败（41804）、已有任务在执行（41793）。这说明：自主回充走导航任务体系，且**SDK 连接断开会使机器人自动停任务**（有利于安全，但载荷计算机/网络必须稳定）。
- 使用前提：用《绝影 X30 Pro 应用手册》完成建图，用手柄创建导航路线并同步到导航主机（文件名 `default_navigation_points.json`）✅——**路线靠人工创建，能否经 API 动态创建 ⚠️**。
- 部署限制 ❗：禁止安装到 106 导航主机或机器人其他主机 ✅。

### 4.3 计算单元与 ROS 2

- 厂商页面描述"智能控制器的导航主机负责业务程序，主要提供建图与定位导航"✅；X30 Pro 有 RTK、一键急停、IP67、4 h 续航、负载 20 kg ✅（经销商页面）。
- 是否提供可挂载自备计算单元的机械/供电/网络接口、是否开放 ROS 2 话题：**未知 ⚠️**。设计前提：载荷计算机为**独立 Orin NX 模块**，通过以太网接入机器人内网，自供 12 V。
- 同一厂商的 DR02 Pro 导航主机运行 Ubuntu 22.04 + ROS 2 Humble（arm64）✅，但这**不能**推出 X30 同样如此。

## 5. 能力矩阵

结论取值：**可用 / 部分可用 / 缺口 / 未知**。"附实现路径"即桥内实现方式；"待证"项对应 §8 问题编号。

| 契约动作 | Go2 EDU（原型） | 实现路径（Go2） | X30（试点） | 实现路径（X30） |
|---|---|---|---|---|
| `go_to` | **部分可用** | Nav2 + 自带 SLAM/定位 → `cmd_vel` → `obstacles_avoid.Move`；到点判定由桥完成。缺口：厂商无导航 API；雷达点云可用性 ⚠️（U-3） | **可用**（前提：已建图并有导航点） | `1003` 单点 `NavigationPoint`；站场 waypoint ↔ 厂商地图点用 `vendor_ref`/`value` 映射；字段语义待证（DR-5） |
| `start_patrol` | **部分可用** | 桥内按 `patrol_routes.waypoint_ids` 顺序执行 `go_to`；厂商无巡检任务 | **部分可用** | `1003` 多点列表，或厂商"导航路线"（手柄创建→同步）；智巡平台任务模板为备选；能否 API 动态建线待证（DR-7、DR-9） |
| `stop` | **可用** | `StopMove`（软）/`Damp`（硬），独立 `SportClient` + 短超时 + 专用线程；100 ms 需实测（U-2） | **部分可用 ⚠️** | `1004` 取消导航任务；无公开的直接停止/阻尼接口；取消后减速行为、延迟无依据；硬件急停/遥控器为最后防线（DR-4） |
| `return_home` | **部分可用** | `go_to(home)`；缺口：自动上充电座无 SDK 入口（U-5） | **部分可用 ⚠️** | 导航任务含自主充电流程（错误码 41794–41797 为证）；触发方式未文档化；备选：Station `dog.chargeControl`（DR-6、DR-9） |
| `follow` | **缺口** | `SportClient` 无跟随；自研：相机人体检测/跟踪 → 速度环 `Move`（Phase 2 视预算）。原型阶段可降级为"不支持"（U-8） | **未知** | 无公开接口（DR-8） |
| `turn` | **可用** | `Move(0,0,vyaw)` + `imu_state` yaw 闭环到目标角度；角速度范围 ⚠️（U-2） | **未知** | robotserver 无速度/转向；近似方案：以当前位置为目标、改 `angleYaw` 的单点导航 ⚠️ 未验证（DR-8） |
| `speed` | **部分可用** | `SpeedLevel` + 桥内速度夹限；档位语义 ⚠️（U-2） | **部分可用** | `NavigationPoint.speed` 逐任务设定；运行中调速未知，可能需取消并重发（DR-5） |
| 状态读取 | **可用** | `sportmodestate` + `lowstate.bms_state`；位置为里程计系 ⚠️（U-3、U-4） | **可用** | `1002` 轮询（电量/位置/朝向/姿态/定位/充电/控制模式）；轮询上限频率待证（DR-5） |

统计：Go2 —— 可用 3、部分可用 4、缺口 1；X30 —— 可用 2、部分可用 4、未知 2。**两个平台的 7 个动作 + 状态都有结论或明确的未知项与问题。**

## 6. 决策：桥的结构与实现路径

1. **契约**：`VendorBridgeBase`（见 CONTRACT.md）——统一动作、状态结构、错误/超时语义；STOP 优先级由基类强制。不改变 D-01～D-12。
2. **Go2 桥（T-108）**：`unitree_go2_bridge.py`，使用 `unitree_sdk2_python`。
   - 两个独立 `SportClient`：`motion`（Move 循环、其他运动）与 `stop`（仅 `StopMove`/`Damp`，超时 <100 ms，专用线程），避免停止排在被卡住的 RPC 后面。
   - `Move` 不返回执行结果，因此速度环以 20–50 Hz 周期重发并观察 `sportmodestate.velocity` 闭环；"无命令后是否自停"⚠️ 先在台架实测，决定重发周期与看门狗。
   - 导航补缺（Nav2）作为独立 ROS 2 节点输出 `cmd_vel`，桥只负责把它转为 `obstacles_avoid.Move`，不把导航逻辑放进桥。
3. **X30 桥（T-211）**：`deeprobotics_x30_bridge.py`，首选 `robotserver_sdk`。SDK 是 C++：
   - 方案 X1（推荐）：C++ 小守护进程（直接用官方 SDK）+ 本机 Unix socket/gRPC 暴露 `connect/state/start_nav/cancel/query`，Python 桥作为客户端——SDK 仍只出现在 `dog_vendor_bridge` 包内的子目录；
   - 方案 X2：pybind11 封装；
   - 方案 X3：在 Python 里按公开的 XML 协议重新实现——**不采用**（协议文档不全，易与固件漂移）。
   - 智巡平台 OpenAPI（HTTP，Python `requests` 即可）作为 `start_patrol/return_home` 的备选后端，**仅当试点站部署智巡平台时启用**（开放问题 Q-C）。
4. **统一抽象回归**：T-211 要求两平台同一测试集通过——契约测试（`test/`）可直接复用于具体桥（把 `FakeVendorBridge` 换成具体桥 + 模拟的传输层）。
5. **STOP 通道**：`dog/<id>/cmd/urgent` 与本地 KWS 均直接调用 `bridge.stop()`（独占线程）；X30 在得到 DR-4 答复前，`stop()` 的文档承诺为"取消导航任务 + 报告 `TIMEOUT/result_unknown`"，不得宣称 ≤100 ms 停稳。
6. **坐标系**：桥输出的 `Position.frame` 如实标注；站场局部坐标与厂商地图/里程计坐标的标定由具体桥 + 站场配置提供（T-108/T-211 交付标定流程）。

## 7. 后果与风险

- **正面**：D-03/D-04 保持不变；契约先行使 T-108/T-211 可并行，dog-sim 与 HIL 可直接复用假桥。
- **RK-04（平台能力缺口）**：从"中/高"细化为——Go2：follow 缺口与 Nav2 补缺（可控，仅原型）；X30：stop 时延/turn/follow/ROS 2/计算单元均无公开依据（高，取决于 C-4 答复）。建议 A-0 把 RK-04 的触发信号改为"DR-1～DR-13 厂商答复到位日期"。
- **RK-10（采购延迟）**：X30 为特价订购，经销商页面无交期；建议 C-4 先要书面报价与交期，原型并行推进（Go2）。
- **安全**：`escalate_stop_to_hard` 默认关闭；`Move` 看门狗与 X30 的"上位机断开自动停任务（41802）"都要在台架/围栏内验证（遵守"任何会让机器人移动的测试必须在台架/围栏内并留日志"）。
- **许可**：`unitree_sdk2_python` BSD-3-Clause、`robotserver_sdk` MIT、Station SDK BSD-3-Clause，均允许商用；X30 手册与固件另有条款，随 DR-12 询问。

## 8. 向厂商索取的问题清单（C-4 / C-1 依据）

优先级：**P0＝阻断设计，须在 Phase 0 内回复；P1＝影响 Phase 1/2；P2＝信息性**。

### 8.1 宇树科技（Go2 EDU）

| # | 问题 | 动作/依据 | 优先级 |
|---|---|---|---|
| U-1 | Go2 内置扬声器/麦克风除 `vui`（开关/音量/灯光）外，是否有任何官方 API 或计划？ | D-04 复核 | P2 |
| U-2 | `SportClient.Move` 的 vx/vy/vyaw 取值范围；无后续命令时多久自动停止；`SpeedLevel` 各档含义；`StopMove` 的典型 RPC 往返延迟与建议超时 | stop、turn、speed | **P0** |
| U-3 | `sportmodestate.position` 的参考系；是否提供官方定位/建图话题；机载 LiDAR 点云的话题名、格式与频率；是否允许在 Orin NX 上跑第三方 SLAM | go_to、状态 | **P0** |
| U-4 | `lowstate.bms_state` 字段说明（SOC、电流、循环次数、单位）；低电量保护阈值与行为 | 状态 | P1 |
| U-5 | 充电座自动回充（上桩）是否开放 API？ | return_home | P1 |
| U-6 | EDU（Orin NX 8/16 GB）机载 Jetson 的网卡名/地址、可用 GPIO、扩展口供电（电压/额定电流）、IP 防护等级、负载上限与对续航的影响 | BOM、电源核算 | **P0** |
| U-7 | 固件/SDK 版本兼容矩阵；`unitree_sdk2_python` 无 tag，推荐锁定哪个 commit/固件版本 | 版本固定 | P1 |
| U-8 | 是否有人体跟随接口？ | follow | P1 |

### 8.2 云深处科技（X30 / X30 Pro）

| # | 问题 | 动作/依据 | 优先级 |
|---|---|---|---|
| DR-1 | 提供《绝影 X30 Pro 应用手册》及**当前有效**的二次开发 SDK 清单；`x30_motion_sdk` 现状（仓库已 404）；是否有行走级（速度/姿态）高层运动接口及文档 | 全部 | **P0** |
| DR-2 | X30 是否提供 ROS 2 接口（话题/服务/消息包、发行版），运行在哪台主机，对外网络如何暴露 | D-03 | **P0** |
| DR-3 | 扩展计算单元：能否挂载自备 Orin NX 载荷（安装位、供电电压/电流、IP 防护、以太网）；`robotserver_sdk` 禁止装在 106 导航主机，载荷机的推荐接入方式 | BOM、架构 | **P0** |
| DR-4 | 停止：`1004` 取消导航任务后的减速时间与停稳时间；是否有直接停止/软急停/阻尼接口（如何触发 41766 软急停）；官方的停止时延指标 | stop ≤100 ms | **P0** |
| DR-5 | `NavigationPoint` 各字段（`pointInfo/value/gait/speed/manner/obsMode/navMode/terrain/posture`）的取值枚举与单位；`1002` 状态电量单位与可轮询频率；运行中调速是否支持 | go_to、speed、状态 | **P0** |
| DR-6 | 自主回充如何通过 API 触发（点属性/任务类型）；充电基站型号、接口与对接精度 | return_home | P1 |
| DR-7 | 能否通过 API 动态创建/下发巡检路线（不用手柄）；`default_navigation_points.json` 格式说明 | start_patrol | P1 |
| DR-8 | 是否有原地转向（速度/角度）与人体跟随接口 | turn、follow | P1 |
| DR-9 | 智巡平台是否随机交付；版本（≥1.3.3）、部署形态、OpenAPI 凭据申请流程；`dog.control` / `task.control` 的语义与延迟；一次试点最低配置与费用 | 备选路径 | P1 |
| DR-10 | 与上位机断开时（41802）的行为与心跳要求；SDK 连接数限制；网络隔离要求 | 安全 | P1 |
| DR-11 | 机体外挂设备的供电口（电压/电流）、安装接口与 IP67 约束；本体 Wi-Fi/5G 模块与外接 CPE 的拓扑 | BOM | P1 |
| DR-12 | SDK 与固件的商用许可、技术支持渠道、更新节奏 | 合规 | P2 |
| DR-13 | 价格（含载荷/基站）、交期、租赁/试用方案 | C-4 | **P0** |

## 9. 开放问题（需 A-0 / 业主裁决，均不改变 D-01～D-12）

| # | 问题 | 建议 |
|---|---|---|
| Q-A | `escalate_stop_to_hard` 默认关闭。软停失败时自动阻尼（机体趴下）是否可接受？ | 默认关闭；在围栏测试后由 A-6 给出安全评估再定 |
| Q-B | `follow` 在 Go2 是缺口、在 X30 未知；FOLLOW_ME 属 P0 与离线核心词。 | 原型阶段将 FOLLOW_ME 的狗端动作降为"待实现"，不阻塞其他 P0；待 U-8/DR-8 答复后再定 Phase 2 是否自研 |
| Q-C | 试点站是否采购智巡平台？ | 取决于 DR-9；不采购则 `start_patrol` 只能走 robotserver 多点导航 |
| Q-D | 协议 §6.3 的 `up/ack.state` 枚举无 `cancelled`（而 §6.1 `commands.state` 有）。 | 请 A-1 在 `packages/protocol` 增补，或明确用 `failed`+`detail=cancelled`（契约暂用后者） |
| Q-E | 若 DR-4 答复表明 X30 无法提供 ≤100 ms 的停止。 | 届时提交 DCR，把 §9.3 的 100 ms 改为"指令下发 ≤100 ms + 机体停稳 ≤ X s（厂商指标）"，并以硬件急停/遥控器作为独立保护 |

## 10. 参考

- https://github.com/unitreerobotics/unitree_sdk2_python （BSD-3-Clause；`go2/sport`、`go2/vui`、`go2/obstacles_avoid`）
- https://github.com/unitreerobotics/unitree_sdk2 （release 2.0.2）
- https://github.com/unitreerobotics/unitree_ros2
- https://github.com/DeepRoboticsLab/robotserver_sdk （MIT；`docs/en/api_reference.en.md`）
- https://github.com/DeepRoboticsLab/station-openapi-devkit （BSD-3-Clause；1.1.0）
- https://github.com/DeepRoboticsLab/deep-robotics-sdk2 、https://github.com/DeepRoboticsLab/deep-robotics-msg
- https://www.robotshop.com/es/products/deep-robotics-x30-pro-industrial-quadruped-robot （2026-10-23）
- https://robostore.com/products/go2-edu-plus-100-tops-computing-quadruped-robot-dog （2026-10-23）
