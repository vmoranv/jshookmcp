const INLINE_SCRIPT_ESCAPE_PATTERN = /[<>/\u2028\u2029]/g;

export function escapeInlineScriptLiteral(value) {
  return value.replace(INLINE_SCRIPT_ESCAPE_PATTERN, (char) => {
    switch (char) {
      case '<':
        return '\\u003C';
      case '>':
        return '\\u003E';
      case '/':
        return '\\u002F';
      case '\u2028':
        return '\\u2028';
      case '\u2029':
        return '\\u2029';
      default:
        return char;
    }
  });
}

export function serializeForInlineScript(value) {
  const serialized = JSON.stringify(value);
  return typeof serialized === 'string'
    ? escapeInlineScriptLiteral(serialized)
    : String(serialized);
}
