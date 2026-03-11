export function mergeUnique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
