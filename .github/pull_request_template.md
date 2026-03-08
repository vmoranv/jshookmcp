## Summary

-

## What changed

-

## Validation

- [ ] `pnpm run check`
- [ ] `pnpm run docs:build` (if docs were touched)
- [ ] `pnpm run audit:tools` (if tools/domains changed)

## Docs / i18n / license checklist

- [ ] Docs updated if behavior or commands changed
- [ ] English and Chinese docs kept in sync if user-facing docs changed
- [ ] No incorrect license text or footer copy introduced
- [ ] No unnecessary third-party VitePress plugin added

## Architecture anti-corrosion notes

- [ ] This change prefers official/built-in capabilities where possible
- [ ] Any new dependency is justified and low-risk
- [ ] A rollback path exists if the dependency/tool proves brittle

## Related issues

- Closes #
