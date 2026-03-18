// Re-export for backward compatibility - redirects to merged handlers.base.ts
export {
  validatePid,
  requireString,
  requirePositiveNumber,
  ProcessHandlersBase as ProcessToolHandlersBase,
} from '@server/domains/process/handlers.base';
