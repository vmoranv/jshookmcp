# Descoped-behaviors spike findings

> 关联 change:`close-descoped-behaviors`(Sprint 7)。
> 本文记录对 2026-05 蓝图中「被 descope 且需要外部资料/规范核对」项的 **spike 结论**。
> 诚实原则:**能用离线证据证实的,给出证据;需要真实样本才能最终仲裁的,明确标注,不伪造"已验证"。**

---

## 1. APK Signature Scheme v4 —— 结论:蓝图 spec 错误(SPEC_ERROR),生产代码正确

### 蓝图声称

`add-apk-signing-block-parse/specs/apk-packer/spec.md` 的 "Scenario: v4 root hash block":
APK Signing Block 内 ID `0x42726577` 是 "v4 root-hash block",要求解析 `schemes.v4.rootHash`(hex)与
`schemes.v4.treeSize`(正整数)。`design.md` 还虚构了 `{algId, digest, treeSize}` 三元组。

### 规范核对(AOSP)

来源:<https://source.android.com/docs/security/features/apksigning/v4> (Android 11+)

- v4 是 **detached / streaming (IncFS) 签名**,结构体 `V4Signature`(`version` / `hashing_info` /
  `signing_info` / 可选 `merkle_tree`)存放在**独立 sidecar 文件** `<apk name>.apk.idsig`,
  且 "A v4 signature requires a complementary v2 or v3 signature"。
- **APK Signing Block 内没有 v4 的 ID-value pair。**
- `hashing_info.bytes` 里有 `raw_root_hash`(Merkle 首页的加盐摘要)、`hash_algorithm`(仅 `1==SHA256`)、
  `log2_blocksize`(仅 `12`)、`salt`;**没有 `treeSize` 字段**,Merkle tree 大小是推导而非声明。
- `0x42726577`(ASCII "Brew")是 **verity padding block**,用于把 Signing Block 补齐到 4096 字节对齐
  (AOSP apksig / 外部研究一致)。生产 `signing-block-types.ts:149-155` 已据此 de-alias,
  `bugfixes.test.ts:34` 锁定该 ID 为 padding。

### 结论与处置

- 蓝图 spec 三重错误:把 padding 当 v4、把 sidecar 内容塞进 Signing Block、要求不存在的 `treeSize`。
- **不实现**该 scenario。生产保持 `0x42726577 = verity padding`,`schemes.v4` 不写入。
- 本 change 做的只是**清理误导产物**:删死类型 `V4Block` / `report.v4?` / `WriteableSchemes.v4`,
  改 `SigningBlockParser.ts` 头部与工具描述里错误的 "v4" 措辞。
- 真 v4 能力(解析 `.apk.idsig`)是**另一个独立 tool** `apk_v4_idsig_parse`(蓝图 design §9 已列为未来项),
  需要外部 `.apk.idsig` 样本 + 新 fixture;**本 change 不含,待真实样本**。

---

## 2. Dart snapshot header 双布局 —— 结论:离线兼容增强,真实 libapp.so 仲裁仍待

### open finding(`tests/benchmarks/CATALOG.md:335`)

`dart_snapshot_header_parse` 在偏移 `0x0C` 读 32-byte version hash,而 dart-sdk / r2flutter 参考布局
把 int64 kind 放 `0x0C`、hash 放 `0x14`;官方布局 fixture 会解出 `kind="unknown"`。benchmark 刻意
只断言 magic + features,待真实 `libapp.so` 仲裁。

### 两套布局(均有出处)

| | kind | 32B hash | features | 出处 |
|---|---|---|---|---|
| **A(现生产默认)** | `+0x04` uint32 | `+0x08` | `+0x28` | Phrack #71(2024-08)、darter、reFlutter;`SnapshotFingerprint.ts` 头注 |
| **B(dart-sdk/r2flutter)** | `+0x0C` int64(低 u32) | `+0x14` | `+0x34` | dart-sdk `runtime/vm/snapshot.h` 相关布局 / r2flutter |

Dart 版本演进中 header 布局确有变化,两者都是**真实存在**的布局,不是单一"正确偏移"。

### 本 change 的处置(离线可证实的最大程度)

- `SnapshotFingerprint.readHeader` 增加**双布局探测**:magic 命中后按两套偏移各解一次,
  取「kind 映射到已知 `KIND_BY_VALUE` 且 features 可解出合理 token」的那套;都失败回落 A。
- 用**纯 Buffer 构造**的可注入 fixture 各测 A / B 一种(离线、可复现、不依赖真实 `libapp.so`)。
- **诚实边界**:这是兼容性增强 + 离线验证,**不是**"确定 0x14 就是对的"。
  最终仲裁(哪个布局对应哪个 Dart/Flutter 版本区间)仍需真实 `libapp.so` 样本;
  在此之前默认布局 A 不变,不影响现有行为。

---

## 3. dart-inspector workflow profile —— 结论:测试锁定 + 策略,保留 full-only

`add-dart-strings-extract` 蓝图要求 `profiles: ['workflow','full']`,生产仅 `['full']`。
`tests/server/domains/dart-inspector/manifest.test.ts:24-27`:
`it('is only enabled in the full profile (heavy file I/O)')` 明确
`expect(manifest.profiles).toContain('full')` 且 `.not.toContain('workflow')` / `.not.toContain('search')`。

- 这是**有意的产品策略**(dart-inspector 工具做重文件 I/O,不该进轻量 workflow profile),
  不是遗漏。加 `workflow` 会破测试且违背策略。
- **本 change 不加**,保留 `full` only。若将来要开放,需单独的产品决策 + 改该测试。

---

## 4. 明确「仍需外部样本」的清单(本 change 未声称完成)

| 项 | 需要 | 现状 |
|---|---|---|
| 确定哪套 Dart header 布局对应哪些 Dart/Flutter 版本 | 真实 `libapp.so`(多版本) | 双布局兼容已做,版本映射未定 |
| 解析 `.apk.idsig` v4 签名 | 真实/构造的 `.apk.idsig` + `V4Signature` fixture | 未来独立 tool `apk_v4_idsig_parse` |
| 阈值用真实流量标定 | 真实 agent 会话 trace | 属评测治理 change,非本 change |

---

## 5. 与「不伪造」纪律的关系

这三处原本若被当成"普通 descope 缺口"硬补,会分别造成:写进事实错误的 v4 分支、
破坏 heavy-I/O 策略、用单一偏移覆盖另一种真实布局。spike 的价值正是把它们识别为
「规范错误 / 策略锁定 / 需外部仲裁」,并给出**离线可证部分**(双布局兼容、误导文案清理、
规范依据记录)与**明确未决部分**的边界,而不是用"已干完"掩盖。

相关文档:

- `openspec/changes/archive/SUPERSEDED-AUDIT.md`(7 个蓝图的差异清单)
- `openspec/changes/close-descoped-behaviors/design.md`(本 change 的分组与决策)
