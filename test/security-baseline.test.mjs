import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const baseline = JSON.parse(readFileSync(join(root, 'config/security-baseline.json'), 'utf8'));
const document = readFileSync(join(root, 'docs/04-脅威モデルとセキュリティ基準.md'), 'utf8');

test('必須セキュリティ基準が全てリリース阻止条件になっている', () => {
  assert.equal(baseline.controls.length, 10);
  for (const control of baseline.controls) {
    assert.match(control.id, /^SEC-\d{3}$/);
    assert.equal(control.release_blocker, true);
  }
});

test('セキュリティ基準の文書とJSONのIDが一致している', () => {
  for (const control of baseline.controls) {
    assert.equal(document.includes(control.id), true);
  }
});

test('セキュリティ基準に公開用のAWS識別情報がない', () => {
  const content = `${JSON.stringify(baseline)}\n${document}`;
  assert.equal(/\b\d{12}\b/.test(content), false);
  assert.equal(/arn:aws:/i.test(content), false);
  assert.equal(/AKIA[0-9A-Z]{16}/.test(content), false);
});
