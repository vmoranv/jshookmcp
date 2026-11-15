# `binary_key_extract` — 安全告示

> 手写告示页(非 `docs:generate` 生成物)。关联 change:`close-descoped-behaviors`。
> 该工具注册在 `binary-instrument` 域(`src/server/domains/binary-instrument/secrets/`),
> 本页按其能力主题归入 `encoding` 参考路径。

## ⚠️ 候选值未经校验

`binary_key_extract` 扫描二进制文件,返回**疑似**硬编码密钥的字节偏移。输出字段一律命名为
`candidate`(候选),因为:

- 工具**不解密、不验证**候选是否真是密钥;
- 高熵 / Base64 / Hex / 自定义正则命中都可能只是普通数据、压缩块或随机填充;
- 把候选当作真实密钥使用(例如尝试解密、提交凭据、写入配置)可能导致错误结论。

**必须由人工在真实上下文中复核每一个候选**(查看 surrounding bytes、对照构建产物、
用独立工具验证),再决定是否采信。工具描述中的 "Not validated - verify manually" 即此含义。

## 只读性质

- 以 `node:fs` 只读流扫描,**不写文件、不执行扫描到的字节、不生成产物、不发起网络请求**。
- 不修改被扫描文件(ctime/mtime 不变)。

## customPatterns 的安全边界

`customPatterns` 允许传入自定义正则(pattern + 可选 category),但受两层防护:

1. **编译期**:拒绝 `/.../flags` 包装(不允许调用方提供 flags)、非法正则、超长 pattern,
   以及明显的灾难性回溯形态(嵌套量词 `(a+)+`、重叠 alternation)。
2. **运行时**:整次扫描受 `BINARY_SECRETS_CUSTOM_PATTERN_TIMEOUT_MS`(默认 50 ms)预算约束,
   超预算抛 `ToolError('TIMEOUT')`,不会挂起调用。

pattern 只在字节的 latin1 视图上匹配,命中字节仅作为 payload 返回,从不执行。
即便如此,自定义正则仍可能匹配到大量噪声——请配合 `formats`、`scanWindow`、`maxResults`
收敛范围。

## 相关配置

| 环境变量 | 默认 | 作用 |
| --- | --- | --- |
| `BINARY_SECRETS_MAX_CUSTOM_PATTERN_LENGTH` | 256 | 单个 pattern 最大长度 |
| `BINARY_SECRETS_CUSTOM_PATTERN_TIMEOUT_MS` | 50 | 自定义匹配运行时预算(ms) |
| `BINARY_SECRETS_MAX_EXTRACT_DURATION_MS` | 60000 | 整次扫描总预算(ms) |
| `BINARY_SECRETS_MAX_RESULTS` | 500 | 返回候选上限 |

其余 `BINARY_SECRETS_*` 常量见 `.env.example` 的 `src/modules/binary-secrets/constants.ts` 段。

## 参见

- 工具定义:`src/server/domains/binary-instrument/secrets/definitions.ts`
- 扫描实现:`src/modules/binary-secrets/KeyExtractor.ts`、`custom-pattern.ts`
- 域参考(自动生成):`docs/reference/domains/binary-instrument.md`
