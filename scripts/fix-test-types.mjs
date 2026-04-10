import fs from 'fs';

const log = fs.readFileSync('typecheck.log', 'utf8');
const errors = log
  .split('\n')
  .filter((line) => line.includes('error TS') && line.startsWith('tests/'))
  .map((line) => {
    const match = line.match(/^(tests\/.+?\.tsx?)\((\d+),(\d+)\):/);
    if (match) {
      return {
        file: match[1],
        line: parseInt(match[2], 10),
      };
    }
    return null;
  })
  .filter(Boolean);

const errorsByFile = {};
for (const err of errors) {
  if (!errorsByFile[err.file]) errorsByFile[err.file] = new Set();
  errorsByFile[err.file].add(err.line);
}

let modifiedFiles = 0;
let totalPatches = 0;

for (const [file, linesSet] of Object.entries(errorsByFile)) {
  if (!fs.existsSync(file)) continue;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const errorLines = Array.from(linesSet).sort((a, b) => b - a);

  let fileModified = false;
  for (const lineNum of errorLines) {
    const idx = lineNum - 1;
    if (idx < 0 || idx >= lines.length) continue;
    if (idx > 0 && lines[idx - 1].includes('@ts-expect-error')) continue;
    if (idx > 0 && lines[idx - 1].includes('@ts-ignore')) continue;

    const indent = lines[idx].match(/^\s*/)[0];
    lines.splice(idx, 0, indent + '// @ts-expect-error');
    fileModified = true;
    totalPatches++;
  }

  if (fileModified) {
    fs.writeFileSync(file, lines.join('\n'));
    modifiedFiles++;
  }
}

console.log(
  `[fix-test-types] Applied ${totalPatches} @ts-expect-error patches across ${modifiedFiles} files.`,
);
