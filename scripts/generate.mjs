#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadSpec } from './lib/load.mjs';
import { buildModel } from './lib/model.mjs';
import { emit, defaultFileNames } from './lib/emit.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const TARGETS = Object.keys(defaultFileNames);

const USAGE = `Usage:
  node scripts/generate.mjs --target <ts|dart|swift|kotlin> [--out <file>] [--check] [--package <kotlin package>]
  node scripts/generate.mjs --target all --out-dir <dir>

  --out <file>     Write to this file. Without it the output goes to stdout.
  --check          Do not write. Exit 1 when <file> differs from a fresh generation.
  --out-dir <dir>  With --target all, write every target using its default file name.
  --package <pkg>  Kotlin package name (default net.credflare.sdk).`;

export function generate(target, options = {}, root = ROOT) {
  const spec = loadSpec(root);
  return emit(target, spec, buildModel(spec), options);
}

function parseArgs(argv) {
  const args = { check: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    if (a === '--target') args.target = next();
    else if (a === '--out') args.out = next();
    else if (a === '--out-dir') args.outDir = next();
    else if (a === '--package') args.package = next();
    else if (a === '--check') args.check = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`Unknown argument ${a}`);
  }
  return args;
}

function firstDifference(a, b) {
  const x = a.split('\n');
  const y = b.split('\n');
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] !== y[i]) return `line ${i + 1}\n  expected: ${y[i] ?? '<end of file>'}\n  found:    ${x[i] ?? '<end of file>'}`;
  }
  return '';
}

export function main(argv) {
  const args = parseArgs(argv);
  if (args.help || !args.target) {
    console.log(USAGE);
    return args.help ? 0 : 2;
  }
  const options = { package: args.package };
  if (args.target === 'all') {
    if (!args.outDir || args.check) throw new Error('--target all needs --out-dir and does not support --check');
    mkdirSync(args.outDir, { recursive: true });
    for (const t of TARGETS) {
      const file = join(args.outDir, defaultFileNames[t]);
      writeFileSync(file, generate(t, options));
      console.log(`wrote ${file}`);
    }
    return 0;
  }
  if (!TARGETS.includes(args.target)) throw new Error(`Unknown target "${args.target}". Use ${TARGETS.join(', ')} or all.`);
  const output = generate(args.target, options);
  if (args.check) {
    if (!args.out) throw new Error('--check needs --out <file>');
    const current = existsSync(args.out) ? readFileSync(args.out, 'utf8').replace(/\r\n/g, '\n') : null;
    if (current === output) {
      console.log(`${args.out} is up to date`);
      return 0;
    }
    console.error(current === null
      ? `${args.out} does not exist.`
      : `${args.out} is out of date with the spec. First difference at ${firstDifference(current, output)}`);
    console.error(`Regenerate: node scripts/generate.mjs --target ${args.target} --out ${args.out}`);
    return 1;
  }
  if (!args.out) {
    process.stdout.write(output);
    return 0;
  }
  mkdirSync(dirname(resolve(args.out)), { recursive: true });
  writeFileSync(args.out, output);
  console.log(`wrote ${args.out}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
