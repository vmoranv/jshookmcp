import fs from 'fs';

const log = fs.readFileSync('typecheck.log', 'utf8');
const errors = log
  .split('\n')
  .filter((line) => line.includes('error TS2578'))
  .map((line) => {
    const match = line.match(/^(tests\/.+?\.tsx?)[:\(](\d+)[:,](\d+)[\)]?:/);
    if (match) return { file: match[1], line: parseInt(match[2], 10) };
    return null;
  })
  .filter(Boolean);

const errorsByFile = {};
for (const err of errors) {
  if (!errorsByFile[err.file]) errorsByFile[err.file] = new Set();
  errorsByFile[err.file].add(err.line);
}

for (const [file, linesSet] of Object.entries(errorsByFile)) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const errorLines = Array.from(linesSet).sort((a, b) => b - a);

  for (const lineNum of errorLines) {
    const idx = lineNum - 1;
    if (lines[idx] === undefined) continue;

    // Replace the directive
    lines[idx] = lines[idx].replace(/\/\/\s*@ts-expect-error.*/, '');

    // If the line is now empty or just whitespace/empty comment, remove it
    if (lines[idx].trim() === '') {
      lines.splice(idx, 1);
    }
  }

  fs.writeFileSync(file, lines.join('\n'));
}
console.log(`Cleaned TS2578 in ${Object.keys(errorsByFile).length} files.`);
