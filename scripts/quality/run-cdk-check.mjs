import { spawnSync } from 'node:child_process';

const result = spawnSync(
  'corepack',
  ['pnpm', 'exec', 'cdk', 'synth', '--app', 'tsx cdk/bin/app.ts', '--output', 'cdk.out', '--quiet'],
  { stdio: 'inherit' },
);

if (result.error) {
  console.error(`AWS CDKを実行できません: ${result.error.message}`);
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
