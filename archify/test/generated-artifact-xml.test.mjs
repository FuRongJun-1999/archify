import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractSvgs, parseXml } from './helpers/svg-xml.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(skillRoot, '..');
const artifactRoots = [
  'archify/examples',
  'docs',
  'examples',
  'experiments',
];

function trackedHtmlArtifacts() {
  const tracked = spawnSync('git', ['ls-files', '-z', '--', ...artifactRoots], {
    cwd: repoRoot,
    encoding: 'buffer',
  });
  assert.equal(tracked.status, 0, tracked.stderr.toString());
  return tracked.stdout.toString()
    .split('\0')
    .filter((entry) => entry.endsWith('.html'))
    .sort();
}

test('artifact SVG extraction follows HTML quoting and nested SVG structure', () => {
  const extracted = extractSvgs(`
    <script>const ignored = '<svg data-node-label></svg>';</script>
    <template><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/></template>
    <iframe srcdoc='&lt;svg xmlns=&quot;http://www.w3.org/2000/svg&quot;&gt;&lt;svg viewBox=&quot;0 0 1 1&quot;/&gt;&lt;/svg&gt;'></iframe>
  `);
  assert.equal(extracted.direct.length, 1, 'template SVG is markup while script text is not');
  assert.equal(extracted.embedded.length, 2, 'single-quoted srcdoc retains both nested SVG elements');
  for (const svg of [...extracted.direct, ...extracted.embedded]) assert.doesNotThrow(() => parseXml(svg));
});

test('tracked generated artifacts embed well-formed XML SVG', () => {
  const artifacts = trackedHtmlArtifacts();
  assert.ok(artifacts.includes('docs/gallery.html'), 'expected the tracked generated Gallery page inventory');
  let embeddedSvgCount = 0;
  const checkedArtifacts = [];

  for (const relative of artifacts) {
    const html = fs.readFileSync(path.join(repoRoot, relative), 'utf8');
    const extracted = extractSvgs(html);
    embeddedSvgCount += extracted.embedded.length;
    const svgs = [...extracted.direct, ...extracted.embedded];
    if (svgs.length === 0) continue;
    checkedArtifacts.push(relative);
    for (const [index, svg] of svgs.entries()) {
      assert.doesNotThrow(
        () => parseXml(svg),
        `${relative}: SVG ${index + 1} must be well-formed XML`,
      );
    }
  }

  assert.ok(checkedArtifacts.length > 35, 'expected the tracked generated SVG artifact inventory');
  assert.ok(checkedArtifacts.includes('examples/checkout-platform-delta.html'), 'expected the Compare artifact');
  assert.ok(embeddedSvgCount >= 2, 'expected Compare base/head srcdoc SVG snapshots');
});
