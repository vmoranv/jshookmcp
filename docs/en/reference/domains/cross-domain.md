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

- cross-domain + evidence
- cross-domain + v8-inspector + skia-capture

## Full tool list (6)

| Tool | Description |
| --- | --- |
| `cross_domain_capabilities` | List all cross-domain capability categories and available workflows. |
| `cross_domain_suggest_workflow` | Recommend a multi-domain workflow to achieve a specific analysis goal. |
| `cross_domain_health` | Report health status of cross-domain bridges and correlators. |
| `cross_domain_correlate_all` | Run the built-in skia, mojo, syscall, and binary correlators and merge the results into the shared evidence graph. |
| `cross_domain_evidence_export` | Export the shared cross-domain evidence graph as JSON. |
| `cross_domain_evidence_stats` | Get node and edge statistics for the shared cross-domain evidence graph. |
