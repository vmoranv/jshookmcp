# Troubleshooting Guide

This guide covers common issues and their solutions.

---

## Node.js Installation Issues

### webcrack Unsupported Node Version

**Symptom**: `webcrack`-based tools return a runtime error such as `webcrack requires Node.js 22.12+ or 24.x`.

**Cause**: `webcrack@2.16.0` only supports Node 22.x and 24.x. Node 20 is no longer supported for this feature set.

**Solution**:

```bash
# Use a supported Node 22 release
nvm install 22.22.2
nvm use 22.22.2

# Or switch to Node 24
nvm install 24.15.0
nvm use 24.15.0
```

**Verification**:

```bash
node -e "console.log(process.version, process.versions.modules)"
```

---

## Git Hooks Not Installed

**Symptom**: after cloning and running `pnpm install`, `git commit` / `git push` do
not trigger the repository's lefthook hooks.

**Cause**: the project no longer installs git hooks automatically from a package
lifecycle script. It used to, via a `postinstall` hook — but this package is
published under npm's Dual-Use Content Policy, and an install-time script in the
published package is a blocking signal for automated review. The hook was removed
from the published surface; the setup script is now opt-in.

**Solution** — run it once per checkout:

```bash
pnpm run hooks:install
```

That installs the lefthook hooks and, if a native module (`better-sqlite3`,
`isolated-vm`, `koffi`) was built against a different Node ABI, rebuilds it.

**Verification**:

```bash
git config --local --get core.hooksPath   # -> .git/hooks or the lefthook dir
ls .git/hooks/pre-commit
```

If you do not want the hooks at all, just skip the command — nothing else depends
on it.

---

## Trace / SQLite Backend Issues

### better-sqlite3 Missing or ABI Mismatch

**Symptom**: `trace` tools are unavailable, trace tests are skipped, or errors mention `better_sqlite3.node`, `NODE_MODULE_VERSION`, or “compiled against a different Node.js version”.

**Cause**: the `trace` domain uses the optional native SQLite backend `better-sqlite3`. If dependencies were installed under a different Node version, the native binary can target the wrong ABI.

**Solution**:

```bash
# Install the optional trace backend at the project root
pnpm add -O better-sqlite3@12.10.0

# If it was already installed under another Node version, rebuild it
npm rebuild better-sqlite3 --foreground-scripts
```

**Verification**:

```bash
node -e "const Database=require('better-sqlite3'); const db=new Database(':memory:'); db.close(); console.log('better-sqlite3 OK')"
```

Run `doctor_environment` afterwards. It now reports the dedicated `better-sqlite3` health check used by `trace`.

---

## camoufox-js Optional Dependency

**Symptom**: Missing types or runtime errors related to `camoufox-js`.

**Cause**: `camoufox-js` is an optional dependency for stealth browser features.

**Solution**:

```bash
# Install optional browser dependencies and fetch the browser binary
pnpm run install:full

# Or install Camoufox only
pnpm add camoufox-js
pnpm exec camoufox-js fetch
```

If the package is truly missing, stealth features using Camoufox will fall back to standard Puppeteer.

---

## Search Tool Issues

### Tools Not Found After Search

**Symptom**: `search_tools` returns results but `activate_tools` fails.

**Cause**: Tool name mismatch (activation requires the exact name returned by `search_tools`).

**Solution**:

```text
# Use exact name from search_tools response
# Example: search returns "page_navigate" but you try "navigate"

# Correct pattern:
1. search_tools "open a page"
2. Activate the exact tool name returned with activate_tools
3. To activate every tool in a domain at once, use activate_domain
```

### Too Many Activated Tools

**Symptom**: Context fills up after activating many tools.

**Solution**:

```text
# Release tools you no longer need
deactivate_tools { names: ["tool_a", "tool_b"] }

# Activated tools are also released automatically when their activation TTL expires
```

### Search Results Not Relevant

**Symptom**: Low-quality matches from `search_tools`.

**Solution**:

- Use more specific keywords
- Try `activate_domain` for whole domain activation
- Check `SEARCH_INTENT_TOOL_BOOST_RULES_JSON` configuration

---

## Browser Launch Issues

### Chrome/Chromium Not Found

**Symptom**: `browser_launch` fails with "executable not found".

**Solution**:

```bash
# Set explicit path
export CHROME_PATH="/path/to/chromium"
export PUPPETEER_EXECUTABLE_PATH="/path/to/chromium"

# Or use system Chrome on macOS
export PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

### CDP Connection Failures

**Symptom**: "Failed to connect to browser" or debug port issues.

**Solution**:

```bash
# Check default debug port
export DEFAULT_DEBUG_PORT=9222

# Add candidates if using non-standard ports
export DEBUG_PORT_CANDIDATES=9222,9229,9333,2039
```

---

## Extension/Plugin Issues

### Plugin Not Loading

**Symptom**: Plugin doesn't appear in tool list.

**Debug**:

```bash
# Check doctor output
doctor_environment

# Verify plugin directory structure
ls -la plugins/
# Should have: index.ts, manifest.json

# Check logs
LOG_LEVEL=debug pnpm start
```

### Extension Registry Fetch Failed

**Symptom**: `browse_extension_registry` returns empty or errors.

**Cause**: Network issues or registry URL changed.

**Solution**:

```bash
# Verify registry URL
export EXTENSION_REGISTRY_BASE_URL="https://raw.githubusercontent.com/vmoranv/jshookmcpextension/master/registry"

# Or use local registry
export EXTENSION_REGISTRY_BASE_URL="./local-registry"
```

---

## Performance Issues

### High Token Usage

**Symptom**: Rapid token consumption during search.

**Solution**:

```bash
# Reduce token budget
export TOKEN_BUDGET_MAX_TOKENS=100000

# Enable caching
export ENABLE_CACHE=true
export CACHE_TTL=7200
```

### Slow Tool Activation

**Symptom**: Long delay when activating tools.

**Cause**: Loading many tools at once.

**Solution**:

- Use `activate_tools` for specific tools instead of `activate_domain`
- Lower `WORKER_POOL_MAX_WORKERS` if CPU-bound

---

## Getting More Help

### Enable Debug Logging

```bash
export LOG_LEVEL=debug
pnpm start 2>&1 | tee debug.log
```

### Run Doctor Command

```bash
# Check environment health (dependencies, bridges, platform limits)
doctor_environment
```

### Report Issues

When reporting issues, include:

- `node -v` and `pnpm -v`
- Output of `doctor_environment`
- Relevant log excerpts with `LOG_LEVEL=debug`
