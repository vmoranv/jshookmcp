# Transform

Domain: `transform`

AST/string transform domain plus crypto extraction, harnessing, and comparison tooling.

## Profiles

- full

## Typical scenarios

- Preview transforms
- Extract standalone crypto code
- Compare implementations

## Common combinations

- core + transform

## Full tool list (6)

<details>
<summary><b>AST Transforms</b> (3 tools)</summary>

| Tool                    | Description                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| `ast_transform_preview` | Preview lightweight AST-like transforms (string/regex based) and return before/after diff. |
| `ast_transform_chain`   | Create and store an in-memory transform chain.                                             |
| `ast_transform_apply`   | Apply transforms to input code or a live page scriptId.                                    |

</details>

<details>
<summary><b>Crypto Extraction & Testing</b> (3 tools)</summary>

| Tool                        | Description                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| `crypto_extract_standalone` | Extract crypto/sign/encrypt function from current page and generate standalone runnable code.   |
| `crypto_test_harness`       | Run extracted crypto code in worker_threads + vm sandbox and return deterministic test results. |
| `crypto_compare`            | Compare two crypto implementations against identical test vectors.                              |

</details>
