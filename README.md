# 铁路站场人机语音互动系统（RailVoice）

微信小程序（耳朵 + 嘴替）＋ 四足机器狗（腿 + 喇叭）＋ 云端平台（大脑 + 账本）的双向语音互动系统。
本仓库是项目的唯一代码与文档仓库，由 Paperclip 公司 Doumi Playground 的 Agent 团队按实施策划书协作开发。

## 先读这些

| 文件 | 用途 |
|---|---|
| `docs/铁路站场人机语音互动系统-实施策划书-v1.0.md` | 项目唯一事实源：需求分析、架构决策 D-01～D-12、协议、任务卡、Agent 简报、KPI |
| `docs/parts/01-overview.md` … `12-actions-appendix.md` | 同一策划书按章节拆分，便于按需加载 |
| `docs/seed/command-lexicon.v1.json` | 指令词库种子（三元组：中文主指令 / 方言别名 / 英文等价） |
| `docs/owner-actions.md` | 业主行动项跟踪表（账号、备案、密钥、采购、现场） |
| `docs/risk-register.md` | 风险登记册 |
| `tools/windows-git-shim.ps1` | Windows 主机上让 Paperclip 托管的 GitHub 凭据对 git 生效的辅助脚本 |

## 仓库结构（由任务 T-001 建立）

```
apps/        miniprogram（微信小程序）、admin-web（管理后台）、gateway（NestJS 云端）
packages/    protocol（zod 协议）、lexicon（词库与意图引擎）、shared
edge/        ROS 2 Humble 节点、ota-agent、arm64 镜像、dog-sim
tools/       mock-xfyun、asr-eval、load
infra/       compose、helm、k3s、ci
docs/        策划书、adr、api、runbooks、test-plans、compliance、hardware
```

## 协作规则（摘要，详见策划书 §9.2）

- 每个 Agent 只改自己负责的目录；跨目录改动在任务中说明并由总负责人评审。
- 分支 `feat/<任务号>-<slug>` → Pull Request → `main`；没有测试与验证记录的 PR 不合并。
- 架构决策 D-01～D-12 不得自行更改；冲突时提交「决策变更申请」（策划书 §9.5）。
- 任何密钥只来自环境变量 / Paperclip 密钥托管，不得出现在代码、日志、文档、评论中。
