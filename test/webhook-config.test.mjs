import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// tsxのローダーをこのプロセスへ直接登録すると循環参照で失敗するため、TypeScriptは子プロセスで読み込む。
// 子プロセスでは createRequire で読む。.ts は package.json の type が無いためCJSとして扱われ、
// ESMのimportでは名前付きexportが default の下に入るため。
const configModulePath = fileURLToPath(new URL('../cdk/lib/github-app-config.ts', import.meta.url));
const requiredKeys = ['rateLimit', 'burstLimit', 'reservedConcurrency'];

function runInChild(script) {
  const output = execFileSync('node', ['--import', 'tsx', '--input-type=module', '-e', script], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(output);
}

// 設定オブジェクトを子プロセスの検査関数へ直接渡し、拒否か受理かを結果として返す。
function assertWebhookReceiverDeployable(webhookReceiver) {
  return runInChild(`
const { createRequire } = await import('node:module');
const require = createRequire(${JSON.stringify(configModulePath)});
const { assertWebhookReceiverDeployable } = require(${JSON.stringify(configModulePath)});
try {
  assertWebhookReceiverDeployable(${JSON.stringify(webhookReceiver)});
  process.stdout.write(JSON.stringify({ ok: true }));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, message: error.message }));
}
`);
}

function allSet(overrides = {}) {
  return {
    rateLimit: 10,
    burstLimit: 20,
    reservedConcurrency: 5,
    ...overrides,
  };
}

test('子プロセス経由で .ts の設定モジュールを読み込み、関数を呼べる', () => {
  const result = assertWebhookReceiverDeployable(allSet());
  assert.deepEqual(result, { ok: true });
});

test('3項目がすべて正の整数なら、デプロイ経路の検査を通る', () => {
  assert.deepEqual(assertWebhookReceiverDeployable(allSet()), { ok: true });
});

for (const key of requiredKeys) {
  test(`${key} が null のとき、デプロイ経路で拒否し、項目名だけを出す`, () => {
    const result = assertWebhookReceiverDeployable(allSet({ [key]: null }));
    assert.equal(result.ok, false);
    assert.match(result.message, new RegExp(key, 'u'));
  });

  test(`${key} が欠落しているとき、デプロイ経路で拒否し、項目名だけを出す`, () => {
    const withoutKey = allSet();
    delete withoutKey[key];
    const result = assertWebhookReceiverDeployable(withoutKey);
    assert.equal(result.ok, false);
    assert.match(result.message, new RegExp(key, 'u'));
  });
}

test('webhookReceiver 全体が欠落しているとき、3項目すべてを未指定として拒否する', () => {
  const result = assertWebhookReceiverDeployable(undefined);
  assert.equal(result.ok, false);
  for (const key of requiredKeys) {
    assert.match(result.message, new RegExp(key, 'u'));
  }
});

// synth経路（品質ゲート用）は、未決の3項目（null）を許す。デプロイ経路との差を固定する。
test('synth経路（allowPlaceholder=true）は未決の3項目（null）を許す', () => {
  const result = runInChild(`
const { createRequire } = await import('node:module');
const require = createRequire(${JSON.stringify(configModulePath)});
const { loadGitHubAppConfig } = require(${JSON.stringify(configModulePath)});
const config = loadGitHubAppConfig(true);
process.stdout.write(JSON.stringify({
  rateLimit: config.webhookReceiver.rateLimit,
  burstLimit: config.webhookReceiver.burstLimit,
  reservedConcurrency: config.webhookReceiver.reservedConcurrency,
}));
`);
  assert.deepEqual(result, { rateLimit: null, burstLimit: null, reservedConcurrency: null });
});
