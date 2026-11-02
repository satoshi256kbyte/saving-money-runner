import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../..', import.meta.url).pathname;
const compose = readFileSync(join(root, 'compose.yaml'), 'utf8');
const requiredFragments = [
  'services:',
  'ministack:',
  'localstack/localstack:4.8.1',
  '4566:4566',
  'ministack-data:',
];
const missingFragments = requiredFragments.filter((fragment) => !compose.includes(fragment));
if (missingFragments.length > 0) {
  console.error(`Ministack定義に必要な項目がありません: ${missingFragments.join(', ')}`);
  process.exit(1);
}

if (compose.includes('AWS_ACCESS_KEY_ID:') || compose.includes('AWS_SECRET_ACCESS_KEY:')) {
  console.error('Compose定義へAWS認証情報を直接記載できません');
  process.exit(1);
}
