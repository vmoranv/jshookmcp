# Transform

域名：`transform`

AST/字符串变换与加密实现抽取、测试、对比域。

## Profile

- full

## 典型场景

- 变换预览
- 加密函数抽取
- 实现差异比对

## 常见组合

- core + transform

## 代表工具

- `ast_transform_preview` — Preview lightweight AST-like transforms (string/regex based) and return before/after diff.
- `ast_transform_chain` — Create and store an in-memory transform chain.
- `ast_transform_apply` — Apply transforms to input code or a live page scriptId.
- `crypto_extract_standalone` — Extract crypto/sign/encrypt function from current page and generate standalone runnable code.
- `crypto_test_harness` — Run extracted crypto code in worker_threads + vm sandbox and return deterministic test results.
- `crypto_compare` — Compare two crypto implementations against identical test vectors.

## 工具清单（6）

| 工具                        | 说明                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| `ast_transform_preview`     | Preview lightweight AST-like transforms (string/regex based) and return before/after diff.      |
| `ast_transform_chain`       | Create and store an in-memory transform chain.                                                  |
| `ast_transform_apply`       | Apply transforms to input code or a live page scriptId.                                         |
| `crypto_extract_standalone` | Extract crypto/sign/encrypt function from current page and generate standalone runnable code.   |
| `crypto_test_harness`       | Run extracted crypto code in worker_threads + vm sandbox and return deterministic test results. |
| `crypto_compare`            | Compare two crypto implementations against identical test vectors.                              |
