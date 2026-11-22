# Security Policy

## Supported Versions

The project ships from `master` as `@jshookmcp/jshook` on npm. Security
updates are backported to the current minor release line; older lines are
supported only as community maintenance.

| Version | Supported          |
| ------- | ------------------ |
| 0.4.x   | :white_check_mark: |
| 0.3.x   | :white_check_mark: |
| 0.2.x   | :white_check_mark: |
| < 0.2   | :x:                |

## Supply-chain posture

The published package (`@jshookmcp/jshook`) is a Node.js CLI / MCP server, not a
browser library. It declares no install-time lifecycle scripts, ships no native
binaries, and loads optional native runtimes (`koffi`, `better-sqlite3`, and the
platform/browser bridges) on demand. Security-relevant capabilities are declared
up front in `DISCLOSURE` and via `contentPolicy.class: dual-use` in `package.json`;
the only default background network egress is opt-out OTLP telemetry
(`JSHOOK_OBSERVABILITY_EXPORTER=none`).

The runtime dependency graph is large (roughly 484 resolved runtime packages,
most of them transitive through the MCP SDK, puppeteer/mockttp, Babel, and
OpenTelemetry). Automated reports flag many outdated packages, single-maintainer
packages, and advisory noise. These are tracked as maintenance debt, not as
package-level defects: `pnpm.overrides` pins security-sensitive transitive
versions (e.g. `hono`, `qs`, `minimatch`, `ws`, `protobufjs`) and batch upgrades
are evaluated against the full test / e2e gate before landing. The OpenTelemetry
trace and metrics stacks are aligned on the 3.1.x SDK and 0.301.2 exporters, so
the previously documented `@opentelemetry/sdk-trace-base` peer-range mismatch no
longer applies.

## Reporting a Vulnerability

Please report security issues privately instead of opening a public issue:

- Open a GitHub Security Advisory at
  <https://github.com/vmoranv/jshookmcp/security/advisories/new>, or
- Email the maintainer via the address listed in the repository profile, or
- Open a private issue via the GitHub security reporting flow.

You can expect an acknowledgment within 7 days and a fix/assessment within
30 days, depending on severity. If the report is accepted, a patched release
will be published and the advisory disclosed after users have had a chance
to upgrade. If it is declined, the reasoning will be explained to the
reporter.

Please do not include real credentials, traffic captures, or production
secrets in the report.
