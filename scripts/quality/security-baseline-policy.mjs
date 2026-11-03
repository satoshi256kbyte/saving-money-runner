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
  { length: 12 },
  (_, index) => `SEC-${String(index + 1).padStart(3, '0')}`,
);

const requiredCategories = new Set([
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

const arnPattern = new RegExp(`${['arn', '[a-z0-9-]+'].join(':')}:`, 'iu');
const githubPatPattern = new RegExp(['github', '_pat_', '[A-Za-z0-9_]{20,}'].join(''), 'u');
const privateKeyPattern = new RegExp(
  ['-----BEGIN ', '(?:RSA |EC |OPENSSH )?', 'PRIVATE KEY-----'].join(''),
  'u',
);

const secretKeys = [
  'secret',
  'token',
  'password',
  'private[_-]?key',
  'webhook[_-]?secret',
  'aws[_-]?secret[_-]?access[_-]?key',
  'api[_-]?key',
  'access[_-]?key',
  'credential',
  'authorization',
  'client[_-]?secret',
].join('|');
const secretValuePattern =
  '(?:"([^"\\r\\n]{6,})"|\'([^\'\\r\\n]{6,})\'|`([^`\\r\\n]{6,})`|([^\\s#;,]{6,}(?:\\s+[^\\s#;,]+)*))';
const secretAssignmentPattern = new RegExp(
  `\\b["']?(?:${secretKeys})["']?\\s*[:=]\\s*${secretValuePattern}`,
  'iu',
);

const shortSecretAssignmentPattern = new RegExp(
  `\\b["']?(?:${secretKeys})["']?\\s*[:=]\\s*(?:["']([A-Za-z0-9._:/+-]{1,5})["']|([A-Za-z0-9._:/+-]{1,5})(?=\\s*(?:$|[,;#])))`,
  'imu',
);

export const forbiddenPublicPatterns = [
  /\b\d{12}\b/u,
  arnPattern,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/u,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/u,
  githubPatPattern,
  privateKeyPattern,
  secretAssignmentPattern,
  shortSecretAssignmentPattern,
];

export function validateSecurityBaseline(baseline, document) {
  if (baseline.version !== 1 || baseline.scope !== 'saving-money-runner-mvp') {
    throw new Error('セキュリティ基準のversionまたはscopeが不正です');
  }
  if (!Array.isArray(baseline.controls) || baseline.controls.length !== requiredIds.length) {
    throw new Error('セキュリティ基準の件数が不正です');
  }

  const ids = baseline.controls.map((control) => control.id);
  if (new Set(ids).size !== ids.length || requiredIds.some((id) => !ids.includes(id))) {
    throw new Error('必須基準IDが重複または欠落しています');
  }

  const categories = new Set(baseline.controls.map((control) => control.category));
  if (Array.from(requiredCategories).some((category) => !categories.has(category))) {
    throw new Error('必須基準カテゴリが欠落しています');
  }

  for (const control of baseline.controls) {
    if (!allowedCategories.has(control.category)) {
      throw new Error(`未定義の基準カテゴリです: ${control.category}`);
    }
    if (
      typeof control.requirement !== 'string' ||
      control.requirement.length === 0 ||
      typeof control.verification !== 'string' ||
      control.verification.length === 0 ||
      control.release_blocker !== true
    ) {
      throw new Error(`基準の必須項目が不足または不正です: ${control.id}`);
    }
    if (!document.includes(control.id)) {
      throw new Error(`基準文書に基準IDがありません: ${control.id}`);
    }
  }
}

export function findForbiddenPublicPattern(text) {
  return forbiddenPublicPatterns.find((pattern) => pattern.test(text));
}
