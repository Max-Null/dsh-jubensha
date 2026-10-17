# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与[语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.1] - 2026-10-18

### Changed

- 适配 DSH 0.2.1：`inject` 的 `webRuntime` 换成 `webStartup`，房间端点的三处信任围栏同步改读 `services.webStartup.trustedHosts`。`webRuntime` 服务自 0.2.1-alpha.2 起被删除，保留旧名会让插件静默停在 PENDING。
- `PlayerChildId` 由 `ContinuableStart['childId']` 改为 `SessionId`：`ContinuableStart` 自 0.2.1-alpha.2 起从 `@deepseek-ai/dsh-subagent` 删除，旧写法只在 `tsc -b` 时报错（`import type` 在运行时被擦除，实机看不出问题）。
