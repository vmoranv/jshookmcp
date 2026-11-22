/**
 * Compatibility re-export.
 *
 * The implementation moved to `@utils/redaction` so `utils/logger` no longer
 * depends upward on `modules/security`. Keep this path for existing consumers
 * and tests; new code should import from `@utils/redaction`.
 */
export {
  redactSensitiveData,
  redactSensitiveString,
  sensitiveJsonReplacer,
} from '@utils/redaction';
