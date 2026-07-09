# 全域军工级审计 — Handoff（2026-07-09 · session 30 · network bot-detect JA3/JA4 integration）

> ⚠️ **.ccg/ 在 .gitignore（L120），但核心文档（handoff/current-status/INDEX 等 6 个）已 tracked，修改正常 `git add` 即可；仅新增 research/ 等文件需 `git add -f`。**
> 本文件是下一位 agent 的入口。所有路径相对项目根 `D:\coding\reverse\jshookmcp\`。
>
> **导航顺序（必读）**：
> 1. 读 `.ccg/tasks/military-grade-audit/current-status.md`
> 2. 读本文件「当前状态」和「NEXT PHASE DECISION」
> 3. 读 `.ccg/tasks/military-grade-audit/INDEX.md`
> 4. 读 `.ccg/tasks/military-grade-audit/domain-10-plan.md`
> 5. 按要做的域读 `.ccg/tasks/military-grade-audit/research/<domain>.md`
>
> **重要澄清**：当前不是全域 10/10。已完成的是 P0/P1 功能项、34 份 research/profile、Phase 2 wrapper pass、Phase 3 大批 feature、Session 23 strict input contract pass、Session 24 browser worker+font、Session 25 network http2-parse+auth-signatures、Session 26 sourcemap indexed+reverse-lookup、Session 27 syscall-hook dtrace-pairing+ETW multi-provider、Session 28 network parse_client_hello JA3+JA4 real ClientHello、Session 29 memory find_accesses 跨平台 disassembly/breakpoint stub 注释标注（annotation-only，未实现，等 Mac 真机接 ptrace/mach_vm_protect）。当前 34 域人工平均约 9.38；最低分组 9.2。诚实 10/10 仍需真实 feature closure + adversarial/boundary 覆盖 + 跨平台 parity。

---

## 当前状态

| 门禁 | 状态 |
|------|------|
| **工具数** | **577**（`pnpm metadata:check` in sync, 2026-07-08） |
| **测试** | **16209 passed / 30 skipped**（997 files passed；latest full check after Session 30 network bot-detect JA3/JA4 integration） |
| **typecheck** | 0 errors（root + extension-sdk） |
| **lint / format** | 全绿 |
| **git — committed** | Through Session 30 `feat(network): integrate JA3/JA4 known-bad matching into bot detection`。前置 3 个 review-fix atomic commit：`488af23d` fix(process) hollowing Linux skip + `2aee71e0` chore(registry) regenerate + `9d964a1b` docs sync。Session 29 memory 标注 `963e44f5` 已 push origin/master。 |
| **git — dirty** | 核心文档（handoff/current-status/INDEX 等）已 tracked，正常 `git add`；仅新增 research/ 文件需 `git add -f`（.ccg/ 在 .gitignore L120）。 |

最终验证命令：

```powershell
pnpm check
```

最新全量通过结果：metadata 577 OK、lint OK、format OK、typecheck OK、Vitest `997 passed`, `16167 passed | 30 skipped`。

当前 CCG 账本：`current-status.md`。`scripts/update-domain-scores.mjs` 只辅助刷新各域 CLAUDE.md Audit Score，不能再作为唯一进度记录。

## Session 27（2026-07-08）：syscall-hook Phase 3 — dtrace entry/return pairing + ETW multi-provider

完成 `syscall-hook` 域 Phase 3 两个真实 capability closure：dtrace return probe 配对 + ETW 多 provider 会话。research `syscall-hook.md` 的 #1（ETW multi-provider）和 #2（dtrace return probes）落地。

- **dtrace entry/return 配对**（`SyscallMonitor.ts`）：此前 `captureWithDTrace` 只挂 `syscall:::entry` 探针，darwin 事件的 `returnValue`/`duration` 永远是 undefined。重写 dtrace 脚本同时发 `:entry` 和 `:return` 探针，各自 printf dtrace 单调 `timestamp`（ns since boot）；`parseDTraceLine` 新增 `pendingEntries` Map（keyed by `${pid}:${syscall}`），entry 探针缓冲 `{ timestampNs, args }` 不发事件，匹配的 return 探针发单个更丰富事件（duration = returnTs − entryTs）。无匹配 entry 的 return 探针降级 best-effort（只带 returnValue）。
- **ETW 多 provider 会话**（`SyscallMonitor.ts`）：新增 `ETW_PROVIDERS` const map（kernel-process `{22fb2cd6-...}` / kernel-network `{7dd42a49-...}` / kernel-file `{edd08927-...}` / kernel-image `{65d92380-...}` GUID），`buildEtwProviderArgs()` 把请求的 provider 名转 `-p <guid> 0xff` 对。`syscall_start_monitor` 新增 `etwProviders` 选项，经 `StartOptions` → `MonitorState` → handler 透传到 `captureWithETW`。省略/空时保留 legacy 单 `NT Kernel Logger` session（`0x10000` flag）——向后兼容。
- **诚实缺口**：`parseETWLine` regex 仍只匹配旧 `logman` stdout 形状，多 provider 的 `xperf` 解码输出仍解析不了——provider 进了 ETL buffer 但事件 decode 没扩。已在 research 文件诚实声明，不在本次 scope。
- **strace flag 误报澄清**：research 文件 #2 称 `captureWithStrace` 缺 `-yy -X verbose`，但 line 530 实际已有——research stale，本次只做 dtrace 部分。

- **接口扩展安全性**：`etwProviders` 是纯加法可选参数（省略时行为不变）；dtrace 配对对 entry-only 调用路径透明（`pendingEntries` 未传时走 legacy 立即发事件分支）。现有 monitor 测试全保留通过（新增 6 个 case）。

- **工具数** 577 不变（不加工具，research #1/#2 是既有 `syscall_start_monitor` 的能力扩展 + 内部 decode 增强）；`scripts/update-domain-scores.mjs`：syscall-hook 9.2→9.4。

- **测试**：`tests/modules/syscall-hook/monitor.test.ts` +4 case（dtrace entry/return 配对 duration、return-only fallback、non-numeric returnValue、ETW provider→GUID arg 映射、legacy fallback），`tests/server/domains/syscall-hook/definitions.test.ts` +1 case（`etwProviders` schema）。206 syscall-hook 测试全绿，全量 16145 passed。

- **验证命令**：

```bash
VITEST_MAX_WORKERS=4 pnpm exec vitest run tests/server/domains/syscall-hook/ tests/modules/syscall-hook/
pnpm metadata:check   # 577 OK
pnpm run typecheck    # 0 errors
node scripts/scan-domain-audit.mjs   # syscall-hook tools=15 tests=13 catch=6 hs=16 exc=2 doc=CSP-（不变，dtrace/ETW 都是既有工具的内部能力）
VITEST_MAX_WORKERS=4 pnpm check      # 16145 passed | 30 skipped
```

## Session 28（2026-07-08）：network Phase 3 — parse_client_hello JA3 + JA4 from real ClientHello

完成 `network` 域 Phase 3 research #3：从真实 ClientHello wire bytes 解析 JA3 + JA4，闭合「compute_tls 只对用户手动喂的数组做 re-hash」的缺口。

- **`parseClientHello`**（`handlers/clienthello-parser.ts`）：纯函数解析 TLS record（hex）→ ClientHello（RFC 5246 §7.4.1.2）。遍历 record header → handshake header → legacy_version → random → session_id → cipher_suites → compressions → extensions block → 逐 extension 解析 type+length+data。返回 `{valid,error,...}` — lenient（不抛错）。
- **`computeJa3`**：Salesforce MD5 of `version,ciphers,extensions,ecpf,ec`。GREASE 整体移除，version 用 legacy client_version。
- **`computeJa4FromClientHello`**：FoxIO JA4，委托 `computeTlsFingerprint`。version 从 supported_versions 推，SNI/ALPN/ciphers/extensions/sigAlgs 从解析结果喂入。
- **新 mode `parse_client_hello`**：`network_tls_fingerprint` 枚举 3→4。必填 `clientHelloHex`，返回 `{ja3,ja3_raw,ja4,ja4_raw}` + 可选 `analysis`（ciphers/exts/grease counts/supportedVersions/ellipticCurves/ecPointFormats/signatureAlgorithms）。
- **测试**：17 parser 单元 + 5 handler 集成。network 928/928，全量 16167/30。
- **工具数** 577 不变；network 9.4→9.6。

## Session 29（2026-07-08）：memory — cross-platform disassembly gap annotation（NOT implementation）

完成 handoff Session 29 首选任务：为 `memory_find_accesses` 的跨平台 disassembly/breakpoint stub 标注缺口位置。**纯注释，不写实现代码**——等 vmoranv 在 Mac 真机上 pull 下来接 ptrace/mach_vm_protect native engine。

- **标注位置**（4 处，全部 `// TODO(macOS/Linux)` + `// NOTE`，指向 `research/memory.md #3`）：
  1. `handlers/find-accesses.ts` `handleFindAccesses` 入口：NOTE（disassembly Win32-only，macOS/Linux fallback raw hex）+ TODO（wire cross-platform bpEngine：Linux ptrace INT3+SIGTRAP / macOS mach_vm_protect+EXC_BAD_ACCESS，+ process_vm_readv/mach_vm_read reader）
  2. `manifest.ts` `null, // hardwareBreakpointEngine`（else 分支）：补 research #3 引用
  3. `manifest.ts` `WIN32_ONLY_TOOLS` 注释：补 ptrace/mach parity 说明 + research #3
  4. `handlers.impl.ts` `makeDisassemblerAdapter` JSDoc：补跨平台说明（capstone WASM 本身跨平台无需 binding，gap 是 bpEngine）
- **handoff 笔误修正**：原 handoff 注释模板写 "see research/memory.md #1" + "requires real capstone native binding linkage"——两处不准。#1 是 instruction-bytes bug（Phase 0 已 FIXED），跨平台 parity 真正条目是 **#3**；capstone 是 WASM 跨平台、**不需 native binding**，真正缺的是 bpEngine。已用准确引用 #3 + 准确技术内容。
- **约束遵守**：不加新测试、不升分（9.7 不变）、不加工具（577 不变）、不改逻辑。
- **gate**：typecheck 0 errors + lint 全绿 + metadata:check 577 in sync。未跑 memory 域测试（handoff 第 7 步：没改逻辑，不必跑）。
- **commit 格式**（handoff 第 8 步）：`docs(memory): annotate cross-platform disassembly gaps for Mac parity work`

## Session 30（2026-07-09）：network Phase 3 — bot_detect_analyze JA3/JA4 integration（零内置特征库）

完成 research #4：把 TLS JA3/JA4 哈希接入 `detectBotSignals`，闭合"TLS 指纹就在隔壁工具算却不用于 bot 检测"的缺口。network 9.6→9.8。

- **设计纠正（用户反馈）**：原 research #4 建议 "add known-bad JA3 hashes (e.g. python-requests default) to the signal list"——预制特征库。用户明确反对："不应该预制硬编码任何特征库和payload"。改为**用户传入** knownBad 列表：工具保持逆向中立，"bad" 是调用者的判断，不是工具预设。
- **`detectBotSignals`**（`handlers/bot-detection.ts`）：新增可选 `jaFingerprint?: { ja3?, ja4?, knownBadJa3?, knownBadJa4? }`。ja3/ja4 始终作信息性 signal 输出（`tls-ja3: <hash>`）；仅当调用者提供 knownBad 列表且哈希匹配时 +0.45 + signal `known-bot-ja3/ja4: <hash前8位>`。不传列表 = 仅暴露指纹不评分。
- **`handleNetworkBotDetectAnalyze`**（`handlers/tls-bot-handlers.ts`）：从 args 取 ja3/ja4/knownBadJa3/knownBadJa4（argString/argStringArray），构造 jaFingerprint 透传 detectBotSignals，应用到会话级所有捕获 requests。
- **schema**（`definitions/analysis-tools.ts`）：`network_bot_detect_analyze` 加 4 个可选参数 + desc 说明 "Ships NO hardcoded feature library"。
- **接口扩展安全性**：jaFingerprint 是纯加法可选参数（不传时行为完全不变）；现有 28 个 bot-detection 测试全保留通过。
- **测试**：7 新 case — 5 纯函数（信息性输出 / knownBad ja3 匹配 / 不匹配 / ja4 独立 / 回归）+ 2 handler 集成（knownBad 匹配加分 / 信息性不加分）。network 935/935，全量 16209/30。
- **工具数** 577 不变（扩展现有工具）；`scripts/update-domain-scores.mjs`：network 9.6→9.8。
- **诚实缺口**：HTTP/2 SETTINGS fingerprint（Akamai）+ Canvas/WGL fingerprint 信号仍未接入（research #4 更深处，out of scope）。

## NEXT PHASE DECISION — Session 31

### ✅ network bot-detect JA3/JA4 集成（Session 30 已完成）

Session 30 已闭合 research #4：`detectBotSignals` + `network_bot_detect_analyze` 接入 ja3/ja4 + 用户传入 knownBad 列表（**零内置特征库**设计）。network 9.6→9.8。HTTP/2 SETTINGS + Canvas/WGL 信号仍缺（更深，out of scope）。

### ✅ memory 跨平台 parity stub 标注（Session 29 已完成）

Session 29 已在 4 处标注 `// TODO(macOS/Linux)` + `// NOTE`（find-accesses.ts / manifest.ts / handlers.impl.ts），指向 `research/memory.md #3`。**实现需 Mac 真机**——ptrace(Linux) / mach_vm_protect(macOS) FFI 在 Windows 上无法调试。vmoranv 在 Mac 上 pull 后按 TODO 注释接 native bpEngine + process_vm_readv/mach_vm_read reader，再移除 `WIN32_ONLY_TOOLS` 过滤。**Windows session 不再碰这个**，除非有 Mac 真机环境。

### ⭐ Session 31 候选（Windows 可做）

1. **sourcemap 9.4→9.6**：research #1（sourcesContent null 推断 source skeleton）或 #4（sourcemap_diff）。
2. **browser 9.5→9.7**：research CDP all-origin cookies + launch enum validation。
3. **network 9.8→9.85+**：HTTP/2 SETTINGS fingerprint（Akamai）接入 bot-detect（Session 30 的诚实缺口）。
4. 其余 9.2 域各自 research 的 P0/P1 真实 gap（见 `domain-10-plan.md`）。

下一位接手：读 `current-status.md` → 选上述候选或某个 9.2 域 → TDD/gate/文档/commit。

---

## Session 26（2026-07-08）：sourcemap Phase 3 — indexed source maps + reverse lookup

完成 `sourcemap` 域 Phase 3 最高 ROI 切片：indexed source map 支持 + `sourcemap_lookup` 反向模式。research `sourcemap.md` 的 #2（indexed）和 #3（reverse lookup）落地。

- **Indexed source map flattening**（`handlers/sourcemap-parsing.ts`）：新增 `flattenIndexedSourceMap` 纯函数 + `IndexedSourceMap`/`SourceMapSection` 类型 + `isIndexedSourceMap` 守卫。v3 spec 的 indexed（sections）形式（webpack code-splitting / Rollup / Closure Compiler 产物）此前在 `normalizeSourceMap` 直接抛 `Only SourceMap version 3 is supported`。现在 `normalizeSourceMap` 检测到 indexed 形式时调用 flatten，把多 section 合并成单一 flat v3：sources/names 全局数组（sources 去重且对齐 sourcesContent）、每 section 的 `sourceIndex`/`nameIndex` 重映射、`generatedLine`/`generatedColumn` 按 section offset 偏移后重新编码 mappings。对全链路透明——`fetch_and_parse`/`coverage`/`lookup`/`reconstruct_tree` 无需改，indexed map 自动走 flat 路径。
- **`sourcemap_lookup` 反向模式**（`handlers/sourcemap-handlers.ts`）：现有只 generated→original。新增当传入 `originalSource`（或 `original.source`）时走 original→generated 反向（调试器设原始断点 / 错误上报服务去混淆生产栈的核心场景）。扫描 mappings 找 `(sourceIndex, originalLine, originalColumn)` 匹配，支持 exact + closest-preceding；source 不在 map 中返回结构化 error。`line`/`column` 在反向模式下不再 required（由 `originalLine`/`originalColumn` 替代）。definitions 同步加 `originalSource`/`originalLine`/`originalColumn` 参数，去掉 `line`/`column` 的 required。
- **接口扩展安全性**：`normalizeSourceMap` 仍是唯一入口，flatten 是纯加法分支；`sourcemap_lookup` 反向模式是纯加法（不传 originalSource 时行为完全不变）。现有 handler 测试全保留通过。
- **测试**：`flatten-indexed.test.ts`（新，5 case：sources 合并 / sources 去重对齐 sourcesContent / names 合并 / mappings 可解码 / 空 sections 报错）+ `handlers.test.ts` +7 case（reverse exact / reverse closest-preceding / reverse source 不在 map / reverse 非法 originalLine / indexed fetch_and_parse / indexed lookup 正向 / 原 3 case 保留）。
- **工具数** 577 不变（不加工具，research #2/#3 是既有工具的能力扩展）；`scripts/update-domain-scores.mjs`：sourcemap 9.2→9.4。

已跑：

```powershell
pnpm vitest run tests/server/domains/sourcemap/
pnpm typecheck && pnpm lint && pnpm format && pnpm metadata:check
node scripts/scan-domain-audit.mjs
VITEST_MAX_WORKERS=4 pnpm check
node scripts/update-domain-scores.mjs
```

`node scripts/scan-domain-audit.mjs` 当前输出：`sourcemap tools=6 tests=11 catch=20 hs=9 exc=1 doc=CS--`（不变，flatten/lookup 都是既有工具的内部能力）。

---

## Session 25（2026-07-08）：network Phase 3 — http2_frame_parse + auth signing-scheme recognition

完成 `network` 域 Phase 3 最高 ROI 切片：HTTP/2 frame build 的逆操作 + auth 提取器的现代签名方案识别。research `network.md` 的 #1（http2 frame parse）和 #2（modern signing schemes）落地。

- **`http2_frame_parse`**（transport tools）：`http2_frame_build` 的逆。新增纯函数 `parseHttp2Frame`（`http2-raw.ts`）解码 hex HTTP/2 frame：9 字节头拆解（3B length + type + flags + streamId，streamId 清保留位宽松处理）→ typeCode 反查 FRAME_TYPE_CODES 派生 frameType（未知 → 'RAW'）→ 按 type 分支语义解码（SETTINGS entries / PING opaque / WINDOW_UPDATE increment / RST_STREAM errorCode / GOAWAY lastStreamId+errorCode+debugData）。**Lenient**：语义解码失败不抛错，设 `decodeError` + 仍返回 `payloadHex`（分析工具对损坏 trace 宽容）。单必填参数 `frameHex`，容忍空格。加入 `RAW_NETWORK_TOOLS`（纯计算不需 browser core）。事件 `network:http2_frame_parsed`（ServerEventMap 加具名 key）。
- **`extract_auth` 签名方案识别**（`auth-extractor.ts`）：在现有 header/query/body 三路 gate **之前**并行执行 signing-scheme 识别，避免 scoreValue 把 SigV4 误判为 generic base64 0.5。新增 `source: 'signature'` + 可选 `scheme` 字段（`aws-sigv4`/`aliyun-acs3`/`dpop`/`oauth2-client-assertion`）。覆盖：
  - **AWS SigV4**：header `authorization: AWS4-HMAC-SHA256 ...`（0.92）+ presigned URL query `X-Amz-Signature`/`X-Amz-Credential`/`X-Amz-Algorithm` 等（0.9，大小写不敏感匹配）
  - **Aliyun ACS3**：`x-acs-signature` header 或 `ACS3-HMAC-SHA256` authorization（0.9）
  - **DPoP**：`DPoP` header（JWT 形态，0.9）
  - **OAuth2 client_assertion**：body 字段（JSON 或 form-urlencoded，0.85）
  - confidence 梯度高于 base64 0.7；query *0.9、body *0.85 乘子照常，仍 >0.4 阈值
  - **consumedHeaderKeys**：被签名检测消费的 header key 标记，避免 generic header 路径重复产出（修复 SigV4 authorization 双报）
  - **form-urlencoded body fallback**：当前 body 只 JSON.parse，新增 `URLSearchParams` fallback（修复 OAuth2 token endpoint 整条 body 漏报 + generic token 字段也能从 form 提取）
  - 新 dedupe key 前缀 `signature:${scheme}:${value.slice(0,8)}`
- **接口扩展安全性**：`AuthFinding.source` union 扩 'signature' + 加 `scheme?` 是低风险——grep 确认无下游消费者做 union 值匹配，handler 原样透传，response schema 不声明 item 形状。38 现有 auth-extractor 测试全保留通过。
- **测试**：`http2-raw-parse.test.ts` 18 case（7 种 frameType 回环 + flags 保留 + streamId 高位 mask + 空格容忍 + 2 lenient decodeError + 5 错误路径）；`auth-extractor.test.ts` +14 case（SigV4 header 双报修复 / presigned query / Aliyun header+auth / DPoP / client_assertion JSON+form / form body generic token 恢复 / bearer 不误判 / 混排排序 / dedupe）。
- **工具数** 576→577；`scripts/update-domain-scores.mjs`：network 9.2→9.4。

已跑：

```powershell
pnpm vitest run tests/server/domains/network/
pnpm typecheck && pnpm lint && pnpm format && pnpm metadata:check
node scripts/scan-domain-audit.mjs
VITEST_MAX_WORKERS=4 pnpm check
node scripts/update-domain-scores.mjs
```

`node scripts/scan-domain-audit.mjs` 当前输出：`network tools=38 tests=38 catch=16 hs=55 exc=8 doc=CS--`（工具 37→38，hs 52→55，exc 7→8）。

---

## Session 24（2026-07-08）：browser Phase 3 — worker inspection + font fingerprint

完成 `browser` 域 Phase 3 最高 ROI 切片：worker 脚本检视 + 字体指纹。research `browser.md` 的 #1（worker inspection）和 #3（font fingerprint）落地，并清理了一个设计反模式（70 行硬编码字体表）。

- **半成品接入**：前一 agent 已写好核心逻辑（`constants/browser.ts` worker/font 常量 + `BrowserTargetSessionManager.dumpTargetScripts()` CDP `Debugger.enable` scriptParsed replay + source hydration + 借用/临时 session 管理 + `CodeCollector` passthrough + `target-control.ts` 两个 handler）。本 session 补齐定义/facade/manifest 绑定、font handler、测试、文档。
- **`browser_list_workers`**（runtime tools）：`Target.getTargets` 过滤 `service_worker`/`shared_worker`/`worker`，3 个 include 布尔（默认 true）+ urlPattern；分类 `dedicated_worker`/`shared_worker`/`service_worker`，`isServiceWorker` 标记。全 false 报错（strict contract）。
- **`browser_worker_scripts`**（runtime tools）：required `targetId` + `includeSource`(默认 false) + `maxScripts`(默认 200)。借 `BrowserTargetSessionManager.dumpTargetScripts`：`Debugger.enable` replay → 收集 → dedupe by scriptId → 可选 `Debugger.getScriptSource`（按 `WORKER_SCRIPT_SOURCE_MAX_BYTES` 截断，默认 256KiB）→ `Debugger.disable`。借用 managed session 优先，否则临时 attach 后 detach（不影响当前 attached target）。
- **`browser_font_fingerprint`**（security tools）：**queryLocalFonts-first**（Local Font Access API，Chromium 103+，零硬编码列表枚举真实字体），不可用/拒授权时回退 `document.fonts.check` 探一个 **8 字体核心集**（`FONT_FALLBACK_PROBE_LIST`，从 70 行砂到 10 行）。stable djb2 hash（同字体集合顺序无关）。`spoof=true` override `document.fonts.check = () => true`。返回 detected/count/hash/source/localFontApiAvailable/spoofed。
- **关键设计决策**：用户挑战"硬编码 70 字体很蠢"→ 改为 queryLocalFonts 为主路径（信息量更高：枚举全部真实字体而非布尔探针），硬编码列表降级为 fallback-only 的最小核心集。`STEALTH_PATCH_MANIFEST` 加 `document.fonts.check` spoof 条目。
- **测试**：`font-fingerprint.test.ts` 11 case（queryLocalFonts 主路径去重 / probe fallback / queryLocalFonts reject 回退 / 都没有时 unavailable / spoof override / hash 稳定性 / maxFonts cap / handler 4 case）+ `target-control.test.ts` +5 case（list 分类/过滤/全 false 报错/scripts targetId 必填/scripts 选项透传）+ `definitions.test.ts` +3 schema 断言。
- **工具数** 573→576；`scripts/update-domain-scores.mjs`：browser 9.2→9.5。

已跑：

```powershell
pnpm vitest run tests/server/domains/browser/font-fingerprint.test.ts tests/server/domains/browser/target-control.test.ts tests/server/domains/browser/definitions.test.ts
pnpm typecheck && pnpm lint && pnpm format && pnpm metadata:check
VITEST_MAX_WORKERS=4 pnpm check
node scripts/update-domain-scores.mjs
node scripts/scan-domain-audit.mjs
```

`node scripts/scan-domain-audit.mjs` 当前输出：`browser tools=72 tests=74 catch=15 hs=55 exc=1 doc=CS--`（hs 从 ~52 升到 55，工具 69→72）。

---

## Session 23（2026-07-06）：strict input contract wave + CCG docs sync

Session 18 之后的实现已提交到 `efa1a88f`，但 CCG military docs 落后。本次同步把 CCG 文档作为主记录：

- `163ec355` streaming：capture cap schema/runtime 对齐。
- `700e404f` debugger：拒绝非法 lifecycle actions。
- `0a035ac5` coordination：insight severity enum 严格校验。
- `11b3f4b1` cross-domain：chain direction enum/schema 限制。
- `d7400312` instrumentation：operation type 和 artifact limit 校验。
- `40dcc0f8` network：response body retry schema/runtime 对齐。
- `2bfd389d` process：拒绝非法 memory pattern type。
- `220afba1` syscall-hook：capture filter 参数校验。
- `a71ff3fb` browser：launch `driver` / `mode` enum 校验。
- `213c0def` native-emulator：Java mock return / field value variant 互斥。
- `e373cb76` maintenance：`cleanup_artifacts` manifest forwards category filters。
- `efa1a88f` proxy：rule action/method/urlPattern/mockStatus/mockBody 严格校验。

Quality note: latest full `pnpm check` passed after `efa1a88f` with `VITEST_MAX_WORKERS=4`; `pnpm metadata:check` reports 573 tools in sync.

## Session 19-22（2026-07-06）：post-protocol feature waves

- Session 19 phase3-quad: `96ddc683` transform AST ops, `852459d2` cross-domain live state, `dc0fa1c0` trace profiler samples, `bda3c94c` mojo encode/decoder work, `2e474096` scan snapshot.
- Session 20 broad feature wave: `99c7127e` binary-instrument Frida spawn, `fa8ada43` adb install/input/probes, `787c4ac6` streaming payload export, `f1177317` encoding codecs/signatures, `d4c52e25` workflow rich macros, `c8ea853e` coordination persistence, `8e1762d4` GraphQL federation, `3e5cde6d` platform ASAR algorithms, `09d5f639` instrumentation snapshots, `707bda48` extension install/info, `73b9f729` native-bridge runtime backends.
- Session 21 lifecycle/UX wave: proxy active rules + arbitrary methods, debugger run-to-location/hit context, cross-domain workflow classifier/evidence graph, mojo extended headers/field labels, adb port mappings/screenrecord, syscall strace enrichment/summaries, browser all-cookie CDP reads, dart identifiers, network custom DNS, maintenance cleanup categories, trace diagnostics, instrumentation stop ops.
- Session 22 validation wave: debugger breakpoint condition validation, coordination handoff updates, cross-domain evidence query, process thread diagnostics, browser page-data hardening, adb mapping mode requirement, sourcemap private-host SSRF reuse, dart Smi width exactness, webgpu format-scoped shader caches, transform chain descriptions.

---

## Session 18（2026-07-06）：protocol-analysis +5 protocol fingerprints

完成 `protocol-analysis` 域最高分/分钟比的 Phase 3 feature：`proto_fingerprint` 从 6 协议扩到 11 协议。

- **新增常量**（`src/constants/network.ts`）：`PROTO_MQTT_CONFIDENCE`(0.85), `PROTO_STUN_CONFIDENCE`(0.92), `PROTO_QUIC_CONFIDENCE`(0.88), `PROTO_SOCKS5_CONFIDENCE`(0.90), `PROTO_H2_CONFIDENCE`(0.90)。
- **新检测分支**（`fingerprint-handlers.ts`，插入 WS 之后、includeKnown 之前）：
  - **STUN**：20+ 字节，bytes[4..7]=0x2112A442（magic cookie），msgType 顶 2 bits=0，msgLen 匹配 payload
  - **QUIC**：6+ 字节，byte[0]=0xc0（long header），bytes[1..4]=0x00000001(v1)/0x00000000(version-negotiation)/0x709a50c4(Facebook mvfst)
  - **SOCKS5**：3+ 字节，byte[0]=0x05，byte[1] 是 CMD(1-3) 或 nmethods(1-9)
  - **MQTT**：2+ 字节，byte[0]>>4 是 type(1-14)，非 PUBLISH(type≠3) 需 lower nibble=0（防 WS 帧误报），remaining-length varint 解码+验证
  - **HTTP/2**：9+ 字节，3-byte BE frameLen + 1-byte frameType(0-9) + 1-byte flags + 4-byte streamId（MSB=0）；拒零长度 DATA 帧（防全零 DNS header 被 HTTP/2 误匹配）
- **链序重排**：TLS→HTTP→SSH→WS→**STUN→QUIC→SOCKS5→DNS→MQTT→HTTP/2**→includeKnown。新协议放 WS 之后、DNS 之前（高特异性 magic cookie/header 优先），MQTT/HTTP/2 放最后（通用格式，最激进）。全零 DNS header 测试已验证不被 HTTP/2 误匹配。
- **测试**：15 新 case（5 协议 × 正例 + 5 协议 × 反例 + 混合 batch）；全 41 既有测试持续绿。
- `scripts/update-domain-scores.mjs`：protocol-analysis 9.1→9.6。

已跑：
```powershell
pnpm vitest run tests/server/domains/protocol-analysis tests/modules/protocol-analysis
pnpm typecheck && pnpm lint && pnpm format && pnpm metadata:check
pnpm check
node scripts/update-domain-scores.mjs
```

## Session 17（2026-07-06）：analysis Phase 3 interprocedural taint

完成 `analysis` 域最高 ROI 的 Phase 3 feature：过程间污点传播。**比 research 描述更大**——发现并修了一个两趟 traverse 顺序 bug（sink 在 Pass 1 判定，propagation 在 Pass 2，导致经中间变量到 sink 的污点漏报，且让一条 sanitizer 测试 trivially 通过）。

- **新文件 `CodeAnalyzerDataFlow.summaries.ts`**：每函数摘要（`taintedParamIndices → returnsSource`），monotonic fixpoint（taint only grows），迭代上限 = `clamp(fns.size, 8, 64)` 防止逆向声明深链（7+ 层 `f7→f6→…→f1`）未收敛；`identifySource`/`calleeName` 共享；`evalExpr`/`processStmt` 走 if/block/for/try/return，跳过嵌套函数（各自有摘要）。
- **`CodeAnalyzerDataFlow.ts` Pass 3**（加法式，不破坏 Pass 1/2 契约）：用摘要跑模块作用域定点收敛（identifier/binary/member-chain/call-site 查摘要），收敛后用 enriched taintMap 重扫 `sinkSites`（Pass 1 记录的 sink 现场）补发 taintPath，对 Pass 1 已有的按 `sourceLine→sinkLine:sinkType` 去重。
- **删除 Pass 2 的盲目 arg[0] call pass-through**——Pass 3 用摘要替代，能区分 taint-passing helper / sanitizer helper / 非 [0] 参数位 / return-source helper。
- **sanitizer set 扩展**：加 `Math.*`（max/min/floor/...）和 `Number.prototype.*` 等 value-sinking builtins，避免 unknown-callee 保守透传对 `Math.max(tainted,0)` 误报（这些函数返回 number，原污点 identity 丢失，视作净化合理）。
- **sourceType 一致性**：Pass 1 写入 `'url'`（location.href）→ 改为 `'user_input'`；保留 `normalizeSourceType` 作 legacy 防御，确保输出 path 的 `source.type` 永远在 union 内。
- **测试**：6 条 TDD interprocedural 测试（identity helper / member-chain / 非[0] 参数 / return-source helper / sanitizer helper 净化 / 递归不挂）+ 翻转 1 条 trivially-passing sanitizer 测试（按 lesson #47，改源码+翻断言到正确行为）+ 2 条回归（10 层逆向 call chain 收敛、normalized source types）。
- **对抗性 review**：spawn review agent 被中断，但其 scratch 测试文件（13 case）揭示了真问题——**F1 7 层逆向链因 MAX_ITERATIONS=6 截断漏报**（已修：上限改 `clamp(fns.size,8,64)`）；**F5 Math.max 误报**（已修：Math.* 进 sanitizer set）；**F9 sourceType='url' 泄漏到输出**（已修：Pass 1 写 'user_input'）。其余 F2/F3（函数体内 call/member-chain 漏报）、F4/F4b（`.get()` 误判 network source）、F7（跨作用域同名）、F8（reassign-clean）是**已知诚实缺口**（intra-function body 不分析、flat module map 无作用域、flow-insensitive）——记录在 INDEX/research，不在本次 scope。
- `scripts/update-domain-scores.mjs`：analysis 9.3→9.8。

已跑：

```powershell
pnpm vitest run tests/modules/analyzer tests/server/domains/analysis
pnpm typecheck && pnpm lint && pnpm format:check && pnpm metadata:check
pnpm check
node scripts/update-domain-scores.mjs
node scripts/scan-domain-audit.mjs
```

## Session 15（2026-07-05）：proxy Phase 3 body/timing capture

完成 `proxy` 的最高 ROI Phase 3 项：capture 不再只有 headers。

- `CaptureEntry` 扩展：`bodyTextPreview`, `bodyBytes`, `bodyPreviewBytes`, `bodyTruncated`, `bodyEncoding`, `bodyUnavailable`, `timing`, `remoteIpAddress`, `remotePort`。
- `proxy_start` request/response listeners：先写入 headers/timing 基础 entry，再异步解析 decoded text body preview，避免改变原有日志出现时机。
- response entry 关联同 ID request，回填 `method`/`url`，因此 `proxy_get_requests({urlFilter})` 能返回完整请求/响应对。
- 新增 `PROXY_CAPTURE_BODY_PREVIEW_BYTES`，默认 16 KiB，避免大 body 注入工具上下文。
- `proxy_get_requests` 描述更新为返回 body previews and timing。
- `scripts/update-domain-scores.mjs`：proxy 8.2→8.6。

已跑：

```powershell
pnpm vitest run tests/server/domains/proxy
pnpm typecheck
node scripts\update-domain-scores.mjs
node scripts\scan-domain-audit.mjs
pnpm check
```

## Session 14（2026-07-05）：native-bridge Phase 3 capability/parity

选择低分且结构缺口明确的 `native-bridge` 继续优化，但没有恢复 runtime manifest，因为 `tests/server/ToolCatalog.test.ts` 明确断言 bridge tools 是 externalized，不属于 built-in ToolCatalog。

- `native_bridge_status`：探测 `/capabilities`；远端返回 `actions/capabilities/supportedActions` 时使用 remote actions，否则 fallback 到静态 Ghidra/IDA action list。
- `ghidra_bridge`：新增 `get_segments` action。
- `ida_bridge`：新增 `search_strings` 和 `get_segments` action，补齐 Ghidra parity。
- `definitions.ts`：同步 action enum 和 IDA `searchPattern` 参数。
- `src/server/domains/native-bridge/CLAUDE.md`：新增本地域文档、Prerequisites、Tool Dependencies、honest gap；扫描从 `doc=----` 变成 `doc=CSPD`。
- `scripts/update-domain-scores.mjs`：native-bridge 8.1→8.4。
- `node scripts\scan-domain-audit.mjs` 当前输出：`native-bridge tools=4 tests=3 catch=0 hs=5 doc=CSPD`。

已跑：

```powershell
pnpm vitest run tests/server/domains/native-bridge tests/server/ToolCatalog.test.ts
pnpm typecheck
node scripts\update-domain-scores.mjs
node scripts\scan-domain-audit.mjs
pnpm check
```

## Session 13（2026-07-05）：Phase 2 residual MCP-safe wrappers

完成 Phase 2 residual 批次，扫描中不再有 `hs=0` 域。仍保留 direct handler 的旧测试契约，仅让 MCP/legacy tool 入口走 wrapper：

- `boringssl-inspector`：28 个 facade 入口新增 `*Tool` wrapper，manifest 移除 registry `wrapResult` 并切 wrapper。
- `coordination`：handoff/page snapshot 入口 + state-board dispatch/watch/io 入口新增 wrapper，manifest 切 wrapper。
- `extension-registry`：5 个入口新增 wrapper，manifest 切 wrapper；已构造 ToolResponse 不再二次嵌套。
- `protocol-analysis`：20 个入口新增 wrapper，manifest 移除 `wrapResult` 并切 wrapper。
- `wasm`：12 个入口新增 wrapper，manifest 切 wrapper。
- `native-bridge`：4 个 legacy handler 新增 `*Tool` wrapper；仍无 manifest/CLAUDE.md，`doc=----` 是后续结构性缺口。
- `node scripts\scan-domain-audit.mjs` 当前输出确认：`boringssl-inspector hs=29`, `coordination hs=12`, `extension-registry hs=6`, `native-bridge hs=5`, `protocol-analysis hs=21`, `wasm hs=13`。
- `scripts/update-domain-scores.mjs` 保守拉分：boringssl-inspector 9.2、coordination 8.6、extension-registry 8.8、native-bridge 8.1、protocol-analysis 9.1、wasm 9.2。

已跑：

```powershell
pnpm vitest run tests/server/domains/boringssl-inspector tests/server/domains/coordination tests/server/domains/extension-registry tests/server/domains/protocol-analysis tests/server/domains/wasm tests/server/domains/native-bridge
pnpm typecheck
node scripts\scan-domain-audit.mjs
node scripts\update-domain-scores.mjs
pnpm format
pnpm lint:fix
pnpm check
```

## Session 12（2026-07-05）：Phase 2 大域 MCP-safe wrappers

完成 Phase 2 的大域 wrapper 批次，仍保留 direct handler 的旧测试契约，仅让 MCP manifest 入口走 wrapper：

- `graphql`：6 个 facade 入口新增 `*Tool` wrapper，manifest 切 wrapper。
- `sourcemap`：sourcemap facade + extension helper wrapper；manifest 六个 sourcemap 工具切 wrapper。
- `platform`：16 个 facade 入口新增 wrapper，内部已有 handleSafe 子 handler 行为保留。
- `process`：27 个 manifest 入口新增 wrapper；base 处理 process/memory，subclass 处理 injection/hollowing/handles/APC/suspend；`process_list` 继续复用 find wrapper。
- `node scripts\scan-domain-audit.mjs` 当前输出：`graphql hs=7`, `sourcemap hs=9`, `platform hs=31`, `process hs=27`。
- `scripts/update-domain-scores.mjs` 保守拉分：graphql 9.1、sourcemap 9.1、platform 9.1、process 9.0。

已跑：

```powershell
pnpm vitest run tests/server/domains/graphql tests/server/domains/sourcemap tests/server/domains/platform tests/server/domains/process
pnpm typecheck
node scripts\scan-domain-audit.mjs
node scripts\update-domain-scores.mjs
pnpm check
```

## Session 11（2026-07-05）：Phase 2 中域 MCP-safe wrappers

完成 Phase 2 的第二批中域 handleSafe 统一，仍保留 direct handler 的旧测试契约，仅让 MCP manifest 入口走 wrapper：

- `streaming`：WS/SSE facade 新增 `*Tool` wrapper，manifest 切 wrapper。
- `workflow`：主 workflow facade 和 `macro` secondary handler 均新增 `*Tool` wrapper，manifest 两组 depKey 均切 wrapper。
- `syscall-hook`：15 个入口新增 `*Tool` wrapper；plain object 输出统一成 MCP ToolResponse，真实抛错结构化 `{ success:false, error, message }`。
- `canvas`：主 Canvas facade + Skia secondary handler 均新增 wrapper；Skia 不再依赖 registry `wrapResult` 做 MCP 包装。
- `encoding` / `transform`：facade 新增 wrapper，防止既有 ToolResponse 二次嵌套。
- `node scripts\scan-domain-audit.mjs` 当前输出：`streaming hs=6`, `workflow hs=11`, `syscall-hook hs=16`, `canvas hs=10`, `encoding hs=6`, `transform hs=8`。
- `scripts/update-domain-scores.mjs` 保守拉分：streaming 8.6、syscall-hook 8.8、canvas 9.4、encoding 9.1、transform 9.1、workflow 9.1。

已跑：

```powershell
pnpm vitest run tests/server/domains/streaming tests/server/domains/workflow tests/server/domains/syscall-hook tests/server/domains/canvas tests/server/domains/encoding tests/server/domains/transform
pnpm typecheck
node scripts\scan-domain-audit.mjs
node scripts\update-domain-scores.mjs
pnpm check
```

## Session 10（2026-07-05）：Phase 2 小域 MCP-safe wrappers

完成 Phase 2 的第一批小域 handleSafe 统一，保留 direct handler 的旧测试契约，仅让 MCP manifest 入口走 wrapper：

- `ResponseBuilder.handleSafe` 现在能识别已构造的 `ToolResponse`，直接返回而不是把 `content` 二次嵌套。
- `mojo-ipc` / `cross-domain` / `proxy` / `trace` / `adb-bridge` 新增 `*Tool` wrapper，并把 manifest registration 切到 wrapper。
- 回归测试覆盖成功路径“不嵌套 content”和异常路径结构化 `{ success:false, error, message }`。
- `node scripts\scan-domain-audit.mjs` 当前输出：`adb-bridge hs=13`, `mojo-ipc hs=6`, `cross-domain hs=7`, `proxy hs=9`, `trace hs=10`。
- `scripts/update-domain-scores.mjs` 保守拉分：adb-bridge 8.6、cross-domain 8.6、mojo-ipc 8.6、proxy 8.2、trace 9.0。

已跑：

```powershell
pnpm vitest run tests/server/domains/adb-bridge
pnpm typecheck
pnpm vitest run tests/server/domains/shared/responseBuilder.test.ts tests/server/domains/mojo-ipc tests/server/domains/proxy tests/server/domains/cross-domain tests/server/domains/trace tests/server/domains/adb-bridge
node scripts\scan-domain-audit.mjs
node scripts\update-domain-scores.mjs
pnpm check
```

## Session 9（2026-07-05）：全 research/profile 补齐 + 审计工具优化

完成用户要求的“所有域 research 以及优化”收尾：

- 补齐 `v8-inspector` 独立 research：`.ccg/tasks/military-grade-audit/research/v8-inspector.md`。
- research 入口统一为 **34 份 profile**：33 个 manifest 工具域 + `native-bridge`（无 manifest、但有 `definitions.ts`/`index.ts` 的 legacy surface）。
- 优化 `scripts/scan-domain-audit.mjs`：
  - 域发现支持 `manifest.ts` 或 `definitions.ts`+`index.ts` legacy 工具域；
  - 工具数支持 `tool('...')`、`objectTool('...')`、definitions scope 内 raw MCP `{ name: '...' }` 三种风格；
  - 重新生成 `scripts/domain-audit.json`，当前输出 `Audited 34 domains`，不再出现 `boringssl/network/webgpu/exploit-dev tools=0` 的误报。
- 更新 `scripts/update-domain-scores.mjs` 的 Phase 1 后分数与扫描口径，并运行脚本刷新域内 `CLAUDE.md` 审计分。
- 更新 `.ccg/tasks/military-grade-audit/INDEX.md` / `domain-10-plan.md` 的 34-profile 索引和 v8 research 链接。

快速一致性检查：

```powershell
node scripts\scan-domain-audit.mjs
node scripts\update-domain-scores.mjs
```

---

## Session 8（2026-07-05）：Phase 1 近免费赢已完成

基于上轮 handoff 的 Phase 1 清单，完成 process/debugger/syscall-hook/trace/webgpu/extension-registry/docs 同步。7 个 commit：

```text
1c484573 docs: refresh reference metadata
bca86720 fix(extension-registry): narrow workflow routing
fecd9750 fix(webgpu): wait for captured commands
bd56096b feat(trace): export category thread tracks
1b5a695e feat(syscall-hook): filter by pid and return value
250805e9 feat(debugger): support function breakpoints
9b697462 feat(process): expose suspend tools and hollowing dumps
```

### 已完成项

| 域 | 结果 | 关键文件 | 提升 |
|----|------|----------|------|
| process | 新增 `process_suspend` / `process_resume` 工具；`includeMemoryDump` 返回受限 memory/disk bytes | `src/server/domains/process/*`, `src/modules/process/memory/scanner.ts` | +0.4 |
| debugger | `breakpoint` 支持 `type=function`，通过 `Runtime.evaluate` 解析函数对象并调用 `Debugger.setBreakpointOnFunctionCall` | `src/modules/debugger/*`, `src/server/domains/debugger/*` | +0.3 |
| syscall-hook | `syscall_filter` 支持 `pid`, `returnValueMin`, `returnValueMax`, `errorOnly` | `src/server/domains/syscall-hook/*` | +0.2 |
| trace | Chrome Trace export 按 category 派生 tid，并写入 `thread_name` metadata | `src/server/domains/trace/handlers.ts` | +0.1 |
| webgpu | `webgpu_capture_commands` 从固定 5s sleep 改为轮询实际 capture state，达成 count 即返回 | `src/server/domains/webgpu/handlers/command-capture.ts` | +0.1 |
| extension-registry | workflow routing 去掉 BLE/HID/serial 等 phantom 触发，指向真实工具 | `src/server/domains/extension-registry/manifest.ts` | +0.2 |
| docs | README 工具数 538→540；reference docs 同步 process/debugger/syscall/trace；中文 process 描述补齐 | `README*.md`, `docs/**` | — |

### 本轮新增/更新测试

- `tests/server/domains/process/process-suspend.test.ts`
- `tests/server/domains/process/hollowing-detection.test.ts`
- `tests/server/domains/debugger/breakpoint-basic.test.ts`
- `tests/server/domains/debugger/definitions.test.ts`
- `tests/server/domains/syscall-hook/handlers.coverage.test.ts`
- `tests/server/domains/trace/handlers.test.ts`
- `tests/server/domains/webgpu/webgpu-capture-commands.test.ts`

关键修复点：

- WebGPU 旧测试在 handler 构造后替换 `ctx.pageController`，导致成功路径空过；已改为构造前注入 mock page，并修正 `webgpuHookState` 匹配。
- Process hollowing 测试运行时已过，但 TypeScript 对多分支 union 返回值无法自动收窄；已加测试局部 result 类型。
- Pre-commit 会自动运行 `docs:generate`，因此 reference 文档变更要放在最后统一提交。

---

## P0 历史（session 7）

P0 5 个真 bug 已在上一轮完成：

```text
17f68336 fix(canvas): Three.js + Babylon adapters + honest Unity message
e725c6e2 fix(exploit-dev): capstone-driven x64 one-gadget scan
c19dc20e fix(memory): wire real readMemory + capstone to find_accesses
c8840e13 fix(boringssl): remove no-op decryptPayload stub + decrypt arg
df55af76 fix(wasm): wasm_memory_inspect reads specified instance, returns multi-instance inventory
```

---

## 当前评分快照（CCG 主账本同步）

| 分数 | 域 |
|------|-----|
| 9.8 | analysis |
| 9.7 | memory |
| 9.6 | encoding, protocol-analysis |
| 9.5 | binary-instrument, browser, native-bridge, v8-inspector, workflow |
| 9.4 | canvas, extension-registry, graphql, network, sourcemap |
| 9.3 | exploit-dev, maintenance, platform, proxy |
| 9.2 | adb-bridge, boringssl-inspector, coordination, cross-domain, dart-inspector, debugger, instrumentation, mojo-ipc, native-emulator, process, streaming, syscall-hook, trace, transform, wasm, webgpu |

Full rationale is in `current-status.md`. Do not regenerate score history only through `scripts/update-domain-scores.mjs`; update CCG docs first, then use the script only to refresh CLAUDE.md score lines.

---

## NEXT PHASE DECISION（2026-07-08，Session 26 后）

当前最低分组是 9.2（16 域）。下一阶段不要再做单纯分数脚本更新；每个增量必须是"真实 capability + strict validation + adversarial tests + CCG docs sync"。

### TOP 8 推荐下一个 phase

| 顺位 | 域 | 当前分 | 推荐切片 | 理由 |
|------|-----|--------|----------|------|
| 1 | **syscall-hook** | 9.2 | ETW provider coverage + DTrace return probes | 当前过滤/summary 已硬化，下一步应补跨平台 capture parity。 |
| 2 | **streaming** | 9.2 | gRPC/fetch-stream/WebRTC + SSE fetch consumer | 现已能导出 payload，下一步补现代流式通道。 |
| 3 | **native-emulator** | 9.2 | SIMD vector FP + ARM crypto opcodes | 大域核心缺口，风险高但单域价值大。 |
| 4 | **instrumentation** | 9.2 | preset return-value mutation + typed DOM/storage/WebAPI artifacts | 已有 session export/stop，下一步补实际 instrumentation expressiveness。 |
| 5 | **boringssl-inspector** | 9.2 | CDP `--ssl-key-log` enable + BoringSSL hook/keylog capture | 直接补 TLS analysis headroom；需要注意浏览器启动参数安全。 |
| 6 | **debugger** | 9.2 | conditional breakpoint helpers + scope pretty-print | 中等工作量、纯 CDP、高频使用。 |
| 7 | **mojo-ipc** | 9.2 | Frida 真 hook + message correlation | 现已能 encode/decode，下一步补真实捕获。 |
| 8 | **coordination** | 9.2 | cross-agent evidence fan-out + workflow handoff chaining | 协作域，结构清晰。 |

### Phase rules

1. 每次只选一个域或一组零冲突小域。
2. 先读对应 `research/<domain>.md`，确认旧建议是否已被当前 commits 覆盖。
3. 先加/翻测试，再实现；如果旧测试锁了错误行为，按 lesson #47 翻断言并说明。
4. 跑 targeted tests，再跑 `pnpm metadata:check`、`node scripts/scan-domain-audit.mjs`、`$env:VITEST_MAX_WORKERS='4'; pnpm check`。
5. 更新 `current-status.md`、`INDEX.md`、`domain-10-plan.md`、`handoff.md` 和 touched research，再 atomic commit。

### 教训备考

- **#47**：feature 前先读既有测试是否锁了错误行为，改源码+翻断言到正确行为，再跑全量看影响面
- **#48**（Session 17 新）：对抗性 review agent 被中断但其 scratch 测试文件救了命——别急着删，跑出 JSON 结果后再清理
- **MSYS_NO_PATHCONV**：commit 时不全局 export，否则 lefthook corepack 钩子全挂
- **CCG docs first**：`.ccg/tasks/military-grade-audit` 在 .gitignore（L120），但核心文档已 tracked（正常 `git add`，仅新增 research/ 需 `git add -f`）；不能只改 `scripts/update-domain-scores.mjs`
- **NEVER `git push --no-verify`**：fix failing hooks，push 必须过全预推检查
