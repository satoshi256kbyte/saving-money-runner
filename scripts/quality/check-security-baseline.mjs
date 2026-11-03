import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readPublicText } from './security-baseline-files.mjs';
import {
  findForbiddenPublicPattern,
  validateSecurityBaseline,
} from './security-baseline-policy.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const baselinePath = join(root, 'config/security-baseline.json');
const documentPath = join(root, 'docs/04-脅威モデルとセキュリティ基準.md');
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const document = readFileSync(documentPath, 'utf8');

validateSecurityBaseline(baseline, document);

const publicText = `${JSON.stringify(baseline)}\n${readPublicText(root)}`;
if (findForbiddenPublicPattern(publicText)) {
  throw new Error('公開用セキュリティ基準に識別情報または認証情報の形式が含まれています');
}
