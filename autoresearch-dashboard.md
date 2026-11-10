# Autoresearch Dashboard: per-tool-quality-debt

**Runs:** 3 / 200 | **Kept:** 2 | **Discarded:** 0 | **Crashed:** 1 | **Checks-failed:** 0
**Best:** debt=607 (run #3, 4635b63) | **Baseline:** debt=616 (run #1)
**Noise floor:** 0 (harness deterministic — 3 identical baseline runs)
**Note:** segment-1 metric name debt2 == extractor debt (+51 constant low_mrr offset); comparisons are delta-based.

| # | commit | debt | delta vs best | status | op | description |
|---|--------|------|---------------|--------|----|-------------|
| 1 | 0956cc0 | 616 | 9 | keep |  | baseline: 565 unmeasured + 51 low_mrr + 0 vector_fail |
| 2 | 0956cc0 | 616 | 9 | crash |  | protocol-analysis coverage batch: +9 cases, 4 fail (2 handler bugs: autoDetect/i |
| 3 | 4635b63 | 607 | — | keep | draft | protocol-analysis coverage batch: +9 cases all pass (fix: no-arg handler ctor, s |
