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

## Representative tools

- `cross_domain_capabilities` — List cross-domain capabilities and workflows.
- `cross_domain_suggest_workflow` — Suggest a cross-domain workflow for a goal.
- `cross_domain_health` — Report cross-domain health.
- `cross_domain_correlate_all` — Run the built-in skia, mojo, syscall, and binary correlators and merge the results into the shared evidence graph.
- `cross_domain_evidence_export` — Export the shared cross-domain evidence graph as JSON.
- `cross_domain_evidence_stats` — Get node and edge statistics for the shared cross-domain evidence graph.

## Full tool list (6)

| Tool | Description |
| --- | --- |
| `cross_domain_capabilities` | List cross-domain capabilities and workflows. |
| `cross_domain_suggest_workflow` | Suggest a cross-domain workflow for a goal. |
| `cross_domain_health` | Report cross-domain health. |
| `cross_domain_correlate_all` | Run the built-in skia, mojo, syscall, and binary correlators and merge the results into the shared evidence graph. |
| `cross_domain_evidence_export` | Export the shared cross-domain evidence graph as JSON. |
| `cross_domain_evidence_stats` | Get node and edge statistics for the shared cross-domain evidence graph. |
