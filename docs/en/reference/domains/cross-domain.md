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

- `cross_domain_capabilities` — List cross-domain capabilities, supported v5.0 domains, and available mission workflows.
- `cross_domain_suggest_workflow` — Suggest the best cross-domain workflow for a reverse-engineering goal.
- `cross_domain_health` — Report cross-domain health, enabled v5.0 domains, and evidence-graph availability.
- `cross_domain_correlate_all` — Ingest artifacts from V8, network, canvas, syscall, mojo, and binary domains into one shared evidence graph with optional cross-links.
- `cross_domain_evidence_export` — Export the shared cross-domain evidence graph as JSON.
- `cross_domain_evidence_stats` — Get node and edge statistics for the shared cross-domain evidence graph.

## Full tool list (6)

| Tool | Description |
| --- | --- |
| `cross_domain_capabilities` | List cross-domain capabilities, supported v5.0 domains, and available mission workflows. |
| `cross_domain_suggest_workflow` | Suggest the best cross-domain workflow for a reverse-engineering goal. |
| `cross_domain_health` | Report cross-domain health, enabled v5.0 domains, and evidence-graph availability. |
| `cross_domain_correlate_all` | Ingest artifacts from V8, network, canvas, syscall, mojo, and binary domains into one shared evidence graph with optional cross-links. |
| `cross_domain_evidence_export` | Export the shared cross-domain evidence graph as JSON. |
| `cross_domain_evidence_stats` | Get node and edge statistics for the shared cross-domain evidence graph. |
