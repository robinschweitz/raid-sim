import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { runCli } from './cli';

process.exit(
  runCli(process.argv.slice(2), {
    readFile: (p) => readFileSync(p, 'utf8'),
    writeFile: (p, c) => writeFileSync(p, c),
    mkdir: (p) => mkdirSync(p, { recursive: true }),
    out: (l) => console.log(l),
  }),
);
