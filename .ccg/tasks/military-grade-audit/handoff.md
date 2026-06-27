# 全域军工级审计 — Handoff

> **发起**: 2026-06-24 11:39 CST
> **Round 1 完成**: 2026-06-24 14:30 CST (8/10 修复)
> **Round 2 完成**: 2026-06-24 18:05 CST (exploit-dev 堆利用 + ShikataGaNai + 论文验证)
> **Round 3 C4 完成**: 2026-06-24 19:50 CST (进程镂空检测)
> **Round 3 C5 完成**: 2026-06-25 10:45 CST (句柄枚举)
> **Round 3 C1 Session 1 完成**: 2026-06-25 22:00 CST (Z3 solver 基础设施)
> **Round 3 C1 Session 2 完成**: 2026-06-26 19:20 CST (RopBuilder Z3 BMC + verify_rop_chain)
> **Gap Scan 完成**: 2026-06-27 (memory +3 tools +39 tests, exploit-dev +3 tools +23 tests)
> **Route C 完成**: 2026-06-27 (exploit-dev 架构级深化: ARM/ARM64 ROP + JOP/COP/COOP + SGN x64)
> **全域评分**: 7.3 → 7.9 → 8.0 → 8.2 → 8.4 → 8.6 → **8.7/10** (+0.1 Route C)

> **下一位接手第一件事**: `pnpm test && npx tsc --noEmit && pnpm metadata:check` 确认状态 (502/14825+/0新增), 然后读本 handoff §「推荐路线」

---

## 进度总览

```
审计 (6/24 11:39-11:58)
  → Round 1 A+B (14:00-14:30) ✓ 8/10
  → Round 2 C+TDD (16:30-18:05) ✓ C3/A5/B1 TDD补
  → Round 3 C4 (19:05-19:50) ✓ process_detect_hollowing
  → Round 3 C5 (6/25 10:00-10:45) ✓ process_enum_handles
  → Round 3 C1 Session 1 (6/25 16:00-22:00) ★ Z3 solver + babel bridge + analysis + 工具
  → Round 3 C1 Session 2 (6/26 18:00-19:20) ★ RopBuilder Z3 BMC + verify_rop_chain + 文档
  → Gap Scan (6/27) ★ memory + exploit-dev 缺口扫描与补漏 (6 tools, +62 tests)
  → Route C (6/27) ★ exploit-dev 架构级深化 (ARM ROP + JOP/COP/COOP + SGN x64)
```

---

## 评分变化

| 域 | 前 | Round 1+2 | Round 3 C1 | Gap Scan | Route C | Δ |
|----|----|-----------|------------|----------|----|
| exploit-dev | 8.7 | 9.5 | 9.8 | 9.8 | **9.8** | +1.1 |
| memory | 8.5 | 8.6 | 8.6 | **9.0** | 9.0 | +0.5 |
| analysis | 7.2 | 8.0 | **8.6** | 8.6 | 8.6 | +1.4 |
| browser | 8.7 | **8.9** | — | — | +0.2 |
| process | 6.0 | 7.0 | **8.0** | — | +2.0 |
| debugger | 8.0 | **8.2** | — | — | +0.2 |
| syscall-hook | 5.5 | **6.0** | — | — | +0.5 |
| v8-inspector | 1.5 | **3.0** | — | — | +1.5 |
| **全域** | 7.3 | 7.9 | 8.4 | 8.6 | **8.7** | +1.4 |
| **exploit-dev** | 8.7 | 9.5 | 9.8 | 9.8 | **9.8** | +1.1 |

---

## 新增工具 (15 个)

| 工具 | 域 | 文件 | 轮次 |
|------|-----|------|------|
| deobfuscate(engine=jscrambler/packer/vm) | analysis | handlers/deobfuscation.ts | R1 |
| breakpoint(logMessage=) | debugger | definitions.tools.core.ts | R1 |
| process_enum_threads | process | handlers/injection-handlers.ts | R1 |
| exploit_encode_shellcode(encoding=shikata_ga_nai) | exploit-dev | handlers/ShikataGaNaiEncoder.ts | R2 |
| exploit_build_heap_spray | exploit-dev | handlers/HeapExploitGenerator.ts | R2 |
| exploit_build_format_string | exploit-dev | handlers/HeapExploitGenerator.ts | R2 |
| process_detect_hollowing | process | handlers/hollowing-detection.ts | R3 C4 |
| process_enum_handles | process | handlers/handle-enumeration.ts | R3 C5 |
| exploit_solve_constraints | exploit-dev | handlers/solve-constraints.ts | R3 C1 |
| exploit_verify_rop_chain | exploit-dev | handlers/verify-rop-chain.ts | R3 C1 |
| **memory_region_enumerate** | **memory** | **handlers/region-enumerate.ts** | **GS** |
| **memory_aob_scan** | **memory** | **handlers/scan.ts (handleAobScan)** | **GS** |
| **memory_find_accesses** | **memory** | **handlers/find-accesses.ts** | **GS** |
| **exploit_generate_egghunter** | **exploit-dev** | **handlers/egghunter-encoder.ts** | **GS** |
| **exploit_build_stack_pivot** | **exploit-dev** | **handlers/stack-pivot.ts** | **GS** |
| **exploit_cache_invalidate** | **exploit-dev** | **handlers.impl.ts** | **GS** |

---

## 新增代码量

- src/ 源码: ~5,310 行
- tests/ 测试: ~1,270 行
- 总工具数: 451 → 494 → 495 → 496 → **502**
- 全量测试: **14825 pass** (1 预存失败: runtime-replay.test.ts, 与审计无关)
- tsc: 2 预存 SyscallResolver 错误, 0 新增

---

## Round 3 路线图

### ✅ Tier 1: 全部完成
| # | 任务 | 域 | 状态 |
|---|------|-----|------|
| C1 | Z3 约束求解器 | exploit-dev + analysis | ✅ |
| C4 | 进程镂空检测 | process | ✅ |
| C5 | 句柄枚举 | process | ✅ |

### ✅ Gap Scan: 全部完成
| # | 任务 | 域 | 状态 |
|---|------|-----|------|
| GS1 | memory_region_enumerate + AOB scan | memory | ✅ |
| GS6 | find_accesses (DR auto-rearm) | memory | ✅ |
| GS3-5 | egghunter + stack pivot + RELRO/cache/doc | exploit-dev | ✅ |

### 🟡 Tier 2: 系统安全补全 (下一站)

| # | 任务 | 域 | 预估 |
|---|------|-----|------|
| C6 | APC 注入检测 (QueueUserAPC + alertable 线程) | process | 4-8h |
| C7 | 内存取证 .dmp 解析 (minidump 库) | memory | 8-16h |
| C8 | @native/syscall DirectNtApi 接入 syscall-hook | syscall-hook | 4-8h |
| D1 | v8-inspector 重构 (heap leak + bytecode) | v8-inspector | 1-2d |
| Issue #77 | npx screenshotDir L3 修复 | bug-fix | 2-4h |

### 🟢 Tier 3: 架构改进 (长期)
| # | 域 | 缺口 | 状态 |
|---|-----|------|------|
| E1 | exploit-dev | ARM/ARM64 ROP | ✅ Route C (2026-06-27) |
| E2 | exploit-dev | JOP/COP/COOP 识别 | ✅ Route C (2026-06-27) |
| E3 | exploit-dev | SGN 真多态 x64 | ✅ Route C (2026-06-27) |
| E4 | native-emulator | NEON long/widening/saturating 补全 | 🟡 进行中 |
| E5 | memory | 非 Windows 平台 parity (heap/PE/breakpoint/speedhack) | 🟡 backlog |
| E6 | exploit-dev | **新缺口: JOP 链构建器** (gadget 识别已有, 无链构建) | 🟡 backlog |
| E7 | exploit-dev | **新缺口: one-gadget 数据库** (libc execve 快捷方式) | 🟡 backlog |
| E8 | exploit-dev | **新缺口: pwntools 兼容输出** (exploit.py 生成) | 🟡 backlog |

---

## 关键文件索引

### Handoff & 规划文档 (.ccg/tasks/, gitignored — 本地留存)
| 文件 | 说明 |
|------|------|
| `.ccg/tasks/military-grade-audit/handoff.md` | ← 你正在读这个 |
| `.ccg/tasks/military-grade-audit-fixes/requirements.md` | 需求增强 + Round 1/2/3 规划 + 缺口清单 |
| `.ccg/tasks/military-grade-audit-fixes/plan.md` | 实施计划 (Phase A+B) |
| `.ccg/tasks/military-grade-audit-fixes/task.json` | 任务状态机 |
| `.ccg/tasks/military-grade-audit/research/final-report.md` | 36 域终极报告 (评分矩阵 + 论文验证) |
| `.ccg/tasks/military-grade-audit/research/mission-brief.md` | 审计标准定义 |
| `.ccg/tasks/c1-z3-solver/plan.md` | C1 Z3 详细实施计划 + 进度日志 |
| `.ccg/tasks/c1-z3-solver/task.json` | C1 任务状态机 |
| `.ccg/tasks/gap-scan-exploit-memory/task.json` | Gap Scan 任务记录 |
| `.ccg/tasks/archive/2026-06/route-c-exploit-arch/complete.md` | Route C 完成报告 |
| `.ccg/tasks/archive/2026-06/route-c-exploit-arch/plan.md` | Route C 实施计划 |
| `.ccg/tasks/archive/2026-06/route-c-exploit-arch/task.json` | Route C 任务状态机 |

### 分域审计报告 (.ccg/tasks/military-grade-audit/research/domains/)
| 文件 | 评分 | 状态 |
|------|------|------|
| `exploit-dev.md` | **9.8/10** (17 tools) | ✅ 最新 |
| `memory.md` | **9.0/10** (33 tools) | ✅ 最新 |
| `browser.md` | 8.9/10 | R1 更新 |
| `analysis.md` | 8.6/10 | R3 C1 更新 |
| `debugger.md` | 8.2/10 | R1 更新 |
| `process.md` | 8.0/10 | R3 C4/C5 更新 |
| `syscall-hook.md` | 6.0/10 | R1 更新 |
| `v8-inspector.md` | 3.0/10 | R1 更新 |
| `native-emulator.md` | 8.5/10 | — |
| `dart-inspector.md` | 5.0/10 | — |
| `network.md`, `trace.md`, `webgpu.md`, etc. | 各种 | 未修改 |

### 本轮新增源码 (Gap Scan)
| 文件 | 行数 | 说明 |
|------|------|------|
| `src/server/domains/memory/handlers/region-enumerate.ts` | ~180 | 跨平台区域枚举 |
| `src/server/domains/memory/handlers/find-accesses.ts` | ~216 | DR 断点自动重装 + disassemble |
| `src/server/domains/exploit-dev/handlers/egghunter-encoder.ts` | ~150 | access 34B + SEH 49B egghunter |
| `src/server/domains/exploit-dev/handlers/stack-pivot.ts` | ~200 | 5 类 pivot gadget 组装 |
| `tests/server/domains/memory/region-enumerate.test.ts` | ~150 | 12 tests |
| `tests/server/domains/memory/aob-scan.test.ts` | ~200 | 15 tests |
| `tests/server/domains/memory/handlers/find-accesses.test.ts` | ~360 | 12 tests |
| `tests/server/domains/exploit-dev/egghunter.test.ts` | ~120 | 7 tests |
| `tests/server/domains/exploit-dev/stack-pivot.test.ts` | ~200 | 9 tests |
| `tests/server/domains/exploit-dev/relro-cache.test.ts` | ~150 | 8 tests |

### 本轮新增源码 (Route C)
| 文件 | 行数 | 说明 |
|------|------|------|
| `src/server/domains/exploit-dev/handlers/gadget-search.ts` | +285 | ARM pop 语义提取 + JOP/COP/COOP 分类 |
| `src/server/domains/exploit-dev/handlers/rop-builder.ts` | +111 | ARM64/ARM32 buildConstraints + svc 检测 |
| `src/server/domains/exploit-dev/handlers/ShikataGaNaiEncoder.ts` | +177 | x64 LEA[RIP] 解码器桩 + REX 编码 |
| `src/server/domains/exploit-dev/types.ts` | +10 | GadgetType + confidence/dispatcher/targetReg |
| `src/server/domains/exploit-dev/definitions.ts` | +9 | type=rop/jop/cop/coop 参数 |
| `tests/server/domains/exploit-dev/arm64-rop.test.ts` | ~312 | 14 tests |
| `tests/server/domains/exploit-dev/jop-gadgets.test.ts` | ~229 | 10 tests |
| `tests/server/domains/exploit-dev/shikata-ga-nai-x64.test.ts` | ~177 | 9 tests |
| `tests/fixtures/exploit-dev/test-arm64.bin` | 52B | ARM64 ldp/ldr/svc/mov/nop fixture |

### Issue #77 L3 关键文件
| 文件 | 行号 | 说明 |
|------|------|------|
| `src/utils/config.ts` | 779 | screenshotDir 用 projectRoot 而非 cwd |
| `src/utils/outputPaths.ts` | 22-31 | MCP_PROJECT_ROOT 优先级已存在 |
| `tests/utils/outputPaths.test.ts` | 100-110 | 需加 npx 路径测试 |

---

## 推荐路线 (下一位接手选择)

### 🟢 Route A: 高分冲击 (2-3 天，全域 8.7→9.0)
做最低分域 — 低投入高产出的"低垂果实"：
- **C8**: syscall-hook DirectNtApi 接入 → 6.0→7.5
- **D1**: v8-inspector heap 泄漏分析 + bytecode → 3.0→5.0
- 全域平均拉高 0.3

### 🟡 Route B: 稳扎稳打 (3-5 天)
独立任务，适合碎片推进：
- **C6**: APC 注入检测 (process, 4-8h) → 8.0→8.5
- **C7**: minidump .dmp 解析 (memory, 8-16h) → 9.0→9.2
- **Issue #77 L3**: npx screenshotDir 修复 (4h)

### 🔴 Route C: exploit-dev 深化 (已完成 ✅ 2026-06-27)
~~ARM/ARM64 ROP + SGN 真多态 + JOP/COP/COOP~~ → **已交付，commit a56601a6**

### 🔵 Route D: exploit-dev 下一阶段 (新，1-3 天)
基于 Route C 产生的**新缺口**继续推进 exploit-dev：
- **E6: JOP 链构建器** (gadget 识别已有, 需链编排) → 1-2d
- **E7: one-gadget 数据库** (libc execve 快捷方式查表) → 1d
- **E8: pwntools 兼容输出** (exploit.py 生成) → 0.5d

---

## 架构门禁 (不可逾越)

1. **工具数 gate**: `pnpm metadata:check` 维持 **502**
2. **测试 gate**: `pnpm test` 必须 **14825+** pass (1 预存失败 runtime-replay.test.ts 无关)
3. **类型 gate**: `npx tsc --noEmit` 零新增错误 (SyscallResolver 2个预存除外)
4. **模式 gate**: 遵循 domain manifest 模式
5. **安全 gate**: 所有 exploit 工具由用户提供 payload, 不内置攻击代码

---

## 经验教训

| # | 教训 | 建议 |
|---|------|------|
| 1 | 7 Builder 并行写代码, 只有 2/7 走了完整 TDD | Builder prompt 加铁律: "先写测试→跑红→再写实现→跑绿" |
| 2 | 审计报告 4 项错误, 源码验证才纠正 | 先读源码再信报告 |
| 3 | 42 个测试 `toEqual`→`toMatchObject` 返回扩展 | 测试用 `toMatchObject` 更健壮 |
| 4 | HeapAnalyzer Agent 改旧代码格式 → 32KB diff | Builder 限定"只改指定函数, 不格式化旧代码" |
| 5 | 全量测试 150s, 每次改动后必跑 | 别赌"小改动没事" |
| 6 | z3-solver CJS only, `exports: null` | 先跑 `scripts/z3-smoke.mjs` 验证 init |
| 7 | Z3 表达式是真实类实例, 别展开 `.ast` | 直接用原型方法 |
| 8 | Symbol 属性在 Proxy mock 中不能当 string | 类型写成 `string \| symbol` |
| 9 | Z3 BMC 覆盖子句 `Or(¬sel, covers)` 是重言式 | 用 `And(sel, covers)` 再 Or |
| 10 | Buffer.reverse() 是 Node 22 标准惯用 | 加 eslint-disable 注释绕过 |
| 11 | `.ccg/` 被 gitignore — handoff 等文档不提交 | **别在 .ccg 目录中提交文件** |
| 12 | `git filter-branch` 会把被删除的文件从所有 commit 中移除 | 修复已在 git 中的文件时，用 `git rm -f` 而非 `filter-branch` |
| 13 | Buffer.writeUInt32LE() requires `>>> 0` for XOR values that go negative | Node 22 严格检查，XOR 后始终 `>>> 0` 再做写入 |
| 14 | ARM64 Capstone BigInt 不能 JSON.stringify | 反汇编结果中 address 始终 `Number()` 转 |
| 15 | Shellcode 缓存键必须包含 arch | x64 encode 不能复用 x86 缓存，反之亦然 |
| 16 | x64 MOV r8-r15 需 REX.W=1 (0x48) | 缺 REX.W 导致寄存器截断到 32 位 |
| 17 | oxfmt 自动格式化已编辑文件 | 最终编辑后必跑 `oxfmt --write` 再 commit |
| 18 | ExploitDevCache 相同输入返回相同输出（非随机） | SGN 多态测试必须 `xorKey` 爆破缓存或清缓存 |
| 19 | Codex `refresh_token_reused`，Gemini `IneligibleTier` | 双模型不可用时 Claude 独审，降级但完整 |

---

**下一位接手第一行命令**: `pnpm test && npx tsc --noEmit && pnpm metadata:check` — 确认 (502/14825+/0新增)
