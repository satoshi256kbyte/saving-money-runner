import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

// レビューと品質ゲートの入口は、失敗を成功と誤認させないことを契約として固定する。
const root = process.cwd();

test('品質ゲートは基点が解決できない場合に成功扱いせず停止する', () => {
  const result = spawnSync('sh', ['scripts/quality-gate.sh'], {
    cwd: root,
    env: { ...process.env, QUALITY_GATE_BASE: 'origin/does-not-exist-for-test' },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /基点 .* が解決できない/u);
});

test('レビュー名は英数字、ドット、アンダースコア、ハイフンだけを許可する', () => {
  const result = spawnSync('sh', ['scripts/review-snapshot.sh', 'bad name;rm'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 2);
});

test('レビュー用スナップショットはoriginを削除し、作業ツリーの変更を含める', () => {
  const snapshotRoot = mkdtempSync(join(tmpdir(), 'review-snapshot-test-'));
  const name = `test-${process.pid}-${Date.now()}`;
  try {
    const result = spawnSync('sh', ['scripts/review-snapshot.sh', name], {
      cwd: root,
      env: { ...process.env, REVIEW_SNAPSHOT_ROOT: snapshotRoot },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const snapshotDir = join(snapshotRoot, `${root.split('/').at(-1)}-review-${name}`);
    assert.equal(existsSync(snapshotDir), true);
    const remotes = spawnSync('git', ['-C', snapshotDir, 'remote'], { encoding: 'utf8' }).stdout;
    assert.equal(remotes.trim(), '', 'スナップショットにoriginが残っている');
  } finally {
    rmSync(snapshotRoot, { recursive: true, force: true });
  }
});

test('スナップショットは、ステージ済みのリネームで旧パスを残さず、追跡中のリンクを複製しない', () => {
  const work = mkdtempSync(join(tmpdir(), 'review-rename-test-'));
  const snapshotRoot = mkdtempSync(join(tmpdir(), 'review-rename-snapshot-'));
  const git = (args) => spawnSync('git', args, { cwd: work, encoding: 'utf8' });
  try {
    git(['init', '-q']);
    git(['config', 'user.email', 'test@example.invalid']);
    git(['config', 'user.name', 'test']);
    mkdirSync(join(work, 'scripts'));
    copyFileSync(
      join(root, 'scripts', 'review-snapshot.sh'),
      join(work, 'scripts', 'review-snapshot.sh'),
    );
    writeFileSync(join(work, 'a.txt'), 'public');
    symlinkSync('a.txt', join(work, 'link.txt'));
    symlinkSync('a.txt', join(work, 'リンク.txt'));
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'init']);
    git(['mv', 'a.txt', 'docs.md']);

    const result = spawnSync('sh', ['scripts/review-snapshot.sh', 'rename-check'], {
      cwd: work,
      env: { ...process.env, REVIEW_SNAPSHOT_ROOT: snapshotRoot },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const snapshotDir = join(snapshotRoot, `${work.split('/').at(-1)}-review-rename-check`);
    assert.equal(existsSync(join(snapshotDir, 'docs.md')), true, '新パスがない');
    assert.equal(existsSync(join(snapshotDir, 'a.txt')), false, '旧パスが残っている');
    assert.equal(
      existsSync(join(snapshotDir, 'link.txt')),
      false,
      '追跡中のリンクが複製されている',
    );
    assert.equal(
      existsSync(join(snapshotDir, 'リンク.txt')),
      false,
      '非ASCII名のリンクが複製されている',
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
    rmSync(snapshotRoot, { recursive: true, force: true });
  }
});
