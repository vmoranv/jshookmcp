# 环境诊断与产物清理

## 环境诊断

### CLI

```bash
pnpm run doctor
```

### MCP 维护工具

- `doctor_environment`

它会检查：

- `camoufox-js`、`playwright-core` 等可选包
- wabt / binaryen / jadx 等命令
- Ghidra / IDA / Burp 本地桥
- 当前 transport / toolProfile / plugin roots / retention 配置
- 平台限制

## 产物清理

### MCP 维护工具

- `cleanup_artifacts`

支持：

- `retentionDays`
- `maxTotalBytes`
- `dryRun`

### 环境变量

- `MCP_ARTIFACT_RETENTION_DAYS`
- `MCP_ARTIFACT_MAX_TOTAL_MB`
- `MCP_ARTIFACT_CLEANUP_ON_START`
- `MCP_ARTIFACT_CLEANUP_INTERVAL_MINUTES`

### 管理目录

- `artifacts/`
- `screenshots/`
- `debugger-sessions/`

## 推荐策略

- 开发机：先 `dryRun` 看结果
- 长时间运行实例：打开 `cleanupOnStart` + 间隔调度
- CI / 临时环境：可以把 retention 设得更短
