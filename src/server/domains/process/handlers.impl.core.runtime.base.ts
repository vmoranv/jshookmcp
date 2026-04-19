// Backward-compatible re-export — redirects to composition facade.
export {
  validatePid,
  requireString,
  requirePositiveNumber,
  ProcessHandlersBase as ProcessToolHandlersBase,
} from '@server/domains/process/handlers.impl';
