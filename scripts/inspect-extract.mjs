import { spawnSync } from 'node:child_process';

const paperPath = process.argv[2] ?? 'storage/papers/2026-04/2505-24848v3-15716b05-184e-4bf2-8f00-dedf98429b9e.pdf';
const out = spawnSync(process.execPath, ['scripts/extract-pdf-text.mjs', paperPath], {
  encoding: 'utf8',
  maxBuffer: 50 * 1024 * 1024,
});

if (out.status !== 0) {
  console.error(out.stderr || out.stdout);
  process.exit(out.status || 1);
}

const data = JSON.parse(out.stdout);
const blocks = (data.pages ?? []).flatMap((page) => page.blocks.map((block, index) => ({
  page: page.page,
  index,
  text: block.text,
  bbox: block.bbox,
  lines: block.lines,
})));

const matches = blocks.filter((block) => /f×t×d|extension: understanding types of reading|figure\s*\d|table\s*\d/i.test(block.text));
console.log(JSON.stringify(matches, null, 2));
