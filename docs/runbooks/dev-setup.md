# 开发环境搭建（从零到 `pnpm -r test` 通过）

适用对象：新开发者 / Agent。Windows（PowerShell）与 Linux（bash）步骤并列给出。依据策划书 §4.5。

## 1. 前置工具

| 工具   | 版本                      | 说明                                               |
| ------ | ------------------------- | -------------------------------------------------- |
| Git    | 2.40+                     |                                                    |
| Node   | 24 LTS（见 `.nvmrc`）     | Windows 可用官方安装包或 `nvm-windows`；Linux 用 `nvm` / Volta |
| pnpm   | 9.x                       | **不要手装**，由 corepack 按 `package.json` 的 `packageManager` 锁定 |
| uv     | 0.8+                      | 管理 Python 虚拟环境与锁文件；会按 `.python-version` 自动获取 Python 3.10 |
| Docker | 26+（含 buildx）          | T-002 起用于 Compose 全栈；本任务的 lint/test 不需要 |

安装 uv：

```powershell
# Windows
winget install --id=astral-sh.uv -e
```

```bash
# Linux / macOS
curl -LsSf https://astral.sh/uv/install.sh | sh
```

## 2. 克隆并安装

```powershell
# Windows PowerShell
git clone https://github.com/dulalalaladu/train-station-project.git
cd train-station-project
corepack enable
pnpm install
```

```bash
# Linux
git clone https://github.com/dulalalaladu/train-station-project.git
cd train-station-project
corepack enable
pnpm install
```

`pnpm install` 同时会：

- 通过根 `postinstall` 执行 `uv sync --all-packages --locked`，创建 `.venv` 并装好全部 Python 包；
- 通过 `prepare` 安装 husky 提交钩子（pre-commit 跑 lint-staged，commit-msg 跑 commitlint）。

### Windows 上 `corepack enable` 报 `EPERM`

`corepack enable` 默认把垫片写进 `C:\Program Files\nodejs`，普通用户无写权限。改用用户目录：

```powershell
$d = "$env:USERPROFILE\.corepack-bin"
New-Item -ItemType Directory -Force $d | Out-Null
corepack enable --install-directory $d
$env:PATH = "$d;$env:PATH"      # 想永久生效就加入用户级 PATH
pnpm -v                         # 应显示 9.15.x
```

## 3. 日常命令

| 命令                 | 作用                                                                  |
| -------------------- | --------------------------------------------------------------------- |
| `pnpm -r lint`       | 逐包 lint：TS 用 ESLint，Python 用 ruff + black `--check`             |
| `pnpm -r typecheck`  | TS 包 `tsc --noEmit`                                                  |
| `pnpm -r test`       | TS 包 vitest，Python 包 pytest；**覆盖率门槛 80%**，不达标即失败       |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | 同上，经 Turborepo 并行与缓存；CI 用这组 |
| `pnpm format`        | Prettier 写入；`pnpm format:check` 仅检查                              |
| `pnpm py:sync`       | 手动重新同步 Python 环境（改了 `pyproject.toml` / `uv.lock` 之后）     |

`docs/` 与 `edge/ros2_ws/` 不参与 Prettier / ESLint 门禁。

## 4. 目录与工具约定

- Node 包：`apps/*`、`packages/*`、`tools/mock-xfyun`、`tools/load`，包名 `@railvoice/<name>`；每包 `lint` / `typecheck` / `test` 三个脚本，继承根 `eslint.config.mjs`、`tsconfig.base.json`、`vitest.shared.mjs`。
- Python 包：`edge/ota-agent`、`edge/sim/dog-sim`、`tools/asr-eval`，登记在根 `pyproject.toml` 的 `[tool.uv.workspace]`；每包带一个只含 `lint` / `test` 脚本的 `package.json`（调用 `scripts/run-py.mjs`），因此 `pnpm -r` 能覆盖它们。新增 Python 包时：加入 `members`、复制该 `package.json` 与 `turbo.json`、执行 `uv lock`。
- ROS 2 包（`edge/ros2_ws/src/*`）用 colcon / ament 构建，不属于 pnpm 或 uv workspace。
- 工具版本集中在 `pnpm-workspace.yaml` 的 `catalog:`；升级时只改这一处。

## 5. 提交与 PR

- 分支：`feat/<任务号>-<slug>`，例如 `feat/T-001-monorepo-skeleton`。
- 提交信息：Conventional Commits，类型限 `feat fix refactor docs test chore perf ci`，如 `feat(infra): 增加 compose 健康检查`。不合规会被 commitlint 拒绝。
- 提交前钩子只检查暂存文件；完整检查由 CI 执行。**不要用 `--no-verify` 绕过**。
- 开 PR 时按模板勾选 DoD（策划书 §9.4），附验证记录。

### 5.1 Windows 主机上推送到 GitHub（Paperclip 托管凭据）

Paperclip 注入的凭据代理在 Windows 上找不到 `git.exe`。推送前在 PowerShell 里：

```powershell
. .\tools\windows-git-shim.ps1                 # 每个 PowerShell 会话执行一次（注意开头的点和空格）
git config user.name  "<你的名字>"
git config user.email "<name>@users.noreply.github.com"
pgit push -u origin feat/T-001-monorepo-skeleton
```

脚本头部有完整说明；只有 `push` / `fetch` 等需要凭据的命令用 `pgit`，本地 `git commit` 等照常用 `git`。

## 6. 常见问题

| 现象                                                    | 处理                                                                                      |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `[run-py] uv is required ...`                           | 安装 uv（见 §1）后重新 `pnpm install`                                                      |
| `[run-py] Python env missing`                           | 运行 `pnpm py:sync`                                                                        |
| `uv sync --locked` 提示 lockfile 需更新                  | 改过 `pyproject.toml` 后先 `uv lock`，并把 `uv.lock` 一并提交                              |
| pnpm 版本不是 9.x                                       | 确认在仓库目录内且已 `corepack enable`；corepack 只在有 `packageManager` 字段的目录里选 9.x |
| 覆盖率不达标                                            | 补测试，不要降低门槛或跳过测试（策划书 §9.2-3）                                            |
| 多个 worktree / 并行 Agent 时钩子行为异常               | husky 通过 `core.hooksPath` 生效，该配置在同一仓库的所有 worktree 间共享；在共享检出里先确认 `.husky/` 存在 |

## 7. 验证你的环境

```powershell
corepack enable ; pnpm install ; pnpm -r lint ; pnpm -r test
```

全部退出码为 0 即环境可用。期望摘要：11 个包（8 个 TS + 3 个 Python）各 1 个冒烟测试通过，覆盖率 100%，无 lint 报错。
