import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const baselinePath = join(root, 'config/security-baseline.json');
const documentPath = join(root, 'docs/04-脅威モデルとセキュリティ基準.md');
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const document = readFileSync(documentPath, 'utf8');
const allowedCategories = new Set([
  'audit',
  'availability',
  'boundary',
  'iam',
  'identity',
  'image',
  'network',
  'runner',
  'secret',
  'webhook',
]);
const requiredIds = Array.from(
  { length: 10 },
  (_, index) => `SEC-${String(index + 1).padStart(3, '0')}`,
);
const controls = baseline.controls;

if (baseline.version !== 1 || baseline.scope !== 'saving-money-runner-mvp') {
  throw new Error('セキュリティ基準のversionまたはscopeが不正です');
}
if (!Array.isArray(controls) || controls.length !== requiredIds.length) {
  throw new Error('セキュリティ基準の件数が不正です');
}

const ids = controls.map((control) => control.id);
if (new Set(ids).size !== ids.length || requiredIds.some((id) => !ids.includes(id))) {
  throw new Error('必須基準IDが重複または欠落しています');
}

for (const control of controls) {
  if (!allowedCategories.has(control.category)) {
    throw new Error(`未定義の基準カテゴリです: ${control.category}`);
  }
  if (
    !control.requirement ||
    !control.verification ||
    typeof control.release_blocker !== 'boolean'
  ) {
    throw new Error(`基準の必須項目が不足しています: ${control.id}`);
  }
  if (!document.includes(control.id)) {
    throw new Error(`基準文書に基準IDがありません: ${control.id}`);
  }
}

const publicText = `${JSON.stringify(baseline)}\n${document}`;
const forbiddenPatterns = [/\b\d{12}\b/, /arn:aws:/i, /AKIA[0-9A-Z]{16}/];
if (forbiddenPatterns.some((pattern) => pattern.test(publicText))) {
  throw new Error('公開用セキュリティ基準に識別情報または認証情報の形式が含まれています');
}
