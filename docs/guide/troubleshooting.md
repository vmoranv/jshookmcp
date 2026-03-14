# Troubleshooting Guide

This guide covers common issues and their solutions.

---

## Node.js Installation Issues

### isolated-vm Build Failures on Node 22/24

**Symptom**: Installation fails with `node-gyp` errors related to `isolated-vm`.

**Cause**: `isolated-vm` (used by webcrack) lacks prebuilt binaries for Node 22 (ABI=127) and Node 24 (ABI=137).

**Solution**:

```bash
# Option 1: Use Node 20 (recommended)
nvm install 20
nvm use 20

# Option 2: Let Node 22/24 compile from source (slow)
# This may take 10+ minutes on first install
npm install --build-from-source

# Option 3: Use pnpm with ignore-scripts (webcrack features disabled)
npm i -g pnpm
pnpm config set ignore-scripts true
pnpm install
# Note: webcrack-based features will be unavailable
```

**Verification**:

```bash
node -e "console.log(process.version, process.versions.modules)"
```

---

## lefthook Postinstall Warnings

**Symptom**: Warning messages during postinstall about `lefthook` or git hooks.

**Cause**: lefthook is a git hooks manager. Warnings are non-blocking.

**Solution**:

```bash
# Silence the warning (harmless)
echo "lefthook: skipped" >> .git/hooks/pre-commit

# Or remove lefthook if not needed
pnpm remove lefthook
```

This is a cosmetic issue and does not affect functionality.

---

## camoufox-js Optional Dependency

**Symptom**: Missing types or runtime errors related to `camoufox-js`.

**Cause**: `camoufox-js` is an optional dependency for stealth browser features.

**Solution**:

```bash
# Install the missing types
npm install --save-dev @types/camoufox-js

# Or if using pnpm
pnpm add -D @types/camoufox-js
```

If the package is truly missing, stealth features using Camoufox will fall back to standard Puppeteer.

---

## Search Tool Issues

### Tools Not Found After Search

**Symptom**: `search_tools` returns results but `activate_tools` fails.

**Cause**: Tool name mismatch or tier not high enough.

**Solution**:

```text
# Use exact name from search_tools response
# Example: search returns "page_navigate" but you try "navigate"

# Correct pattern:
1. search_tools "open a page"
2. Activate the exact tool name returned
3. If tool requires higher tier, use boost_profile
```

### Dynamic Boost Too Aggressive

**Symptom**: Automatically upgraded to `full` tier for simple tasks.

**Solution**:

```bash
# Disable dynamic boost
DYNAMIC_BOOST_ENABLED=false

# Or limit which tiers can be auto-selected
SEARCH_WORKFLOW_BOOST_TIERS=workflow
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
# Check environment health
doctor_environment

# Check specific domain tools
doctor_tools --domain browser
```

### Report Issues

When reporting issues, include:

- `node -v` and `pnpm -v`
- Output of `doctor_environment`
- Relevant log excerpts with `LOG_LEVEL=debug`
