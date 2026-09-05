# Cross-Domain

Domain: `cross-domain`

Cross-domain correlation domain that bridges analysis results across multiple domains, supporting workflow orchestration and evidence graph integration.

## Profiles

- full

## Typical scenarios

- Cross-domain evidence correlation
- Automated reverse engineering workflows
- Multi-signal aggregation analysis

## Common combinations

- cross-domain + instrumentation
- cross-domain + v8-inspector + canvas

## Full tool list (8)

| Tool | Description |
| --- | --- |
| `cross_domain_capabilities` | List all cross-domain capability categories and available workflows. |
| `cross_domain_suggest_workflow` | Recommend a multi-domain workflow to achieve a specific analysis goal. |
| `cross_domain_health` | Report health status of cross-domain bridges and correlators. |
| `cross_domain_correlate_all` | Run the built-in skia, mojo, syscall, and binary correlators and merge the results into the shared evidence graph. |
| `cross_domain_evidence_export` | Export the shared cross-domain evidence graph as JSON. |
| `cross_domain_evidence_query` | Query the shared evidence graph by URL, heap address, function, script, node type, metadata, or chain. |
| `cross_domain_evidence_stats` | Get node and edge statistics for the shared cross-domain evidence graph. |
| `cross_domain_synonym` | Map natural-language queries to tool recommendations using a lightweight synonym graph. Pure TS — no LLM. Useful for discovering which tools implement a concept described in plain English (e.g. "find where the app signs requests" → deobfuscation, crypto, network). |
