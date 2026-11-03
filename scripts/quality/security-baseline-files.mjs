import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ignoredDirectories = new Set(['.git', '.cdk.staging', 'cdk.out', 'coverage', 'node_modules']);

function globToRegExp(pattern) {
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '\\' && pattern[index + 1]) {
      source += pattern[index + 1].replace(/[.+^${}()|[\]\\]/gu, '\\$&');
      index += 1;
    } else if (character === '*') {
      if (pattern[index + 1] === '*' && pattern[index + 2] === '/') {
        source += '(?:.*/)?';
        index += 2;
      } else if (pattern[index + 1] === '*') {
        source += '.*';
        index += 1;
      } else {
        source += '[^/]*';
      }
    } else if (character === '?') {
      source += '[^/]';
    } else if (character === '[') {
      const closingIndex = pattern.indexOf(']', index + 1);
      if (closingIndex > index + 1) {
        const classContent = pattern.slice(index + 1, closingIndex);
        source += classContent.startsWith('!')
          ? `[^${classContent.slice(1)}]`
          : `[${classContent}]`;
        index = closingIndex;
      } else {
        source += '\\[';
      }
    } else {
      source += character.replace(/[.+^${}()|[\]\\]/gu, '\\$&');
    }
  }
  return new RegExp(`^${source}$`, 'u');
}

function readIgnoreRules(root) {
  try {
    return (
      readFileSync(join(root, '.gitignore'), 'utf8')
        .split('\n')
        .map((line) => line.replace(/\r$/u, ''))
        // Gitは末尾の空白を無視するが、`\ `のようにエスケープされた空白は名前の一部として残す。
        .map((line) => line.replace(/(?<!\\)[ \t]+$/u, ''))
        .filter((line) => line.length > 0 && !line.startsWith('#'))
        .map((line) => {
          const negated = line.startsWith('!');
          const rawPattern = negated ? line.slice(1) : line;
          const directoryOnly = rawPattern.endsWith('/');
          const anchored = rawPattern.startsWith('/');
          const pattern = rawPattern.replace(/^\/+|\/+$/gu, '');
          return { anchored, directoryOnly, negated, pattern, regex: globToRegExp(pattern) };
        })
    );
  } catch {
    return [];
  }
}

// `foo/`のような末尾の`/`は、ディレクトリにだけ一致させる。
// ファイル`foo`を除外すると、Gitが収集するはずのファイルを公開検査から外してしまうため。
function ruleMatchesEntry(rule, normalizedPath, isDirectory) {
  if (rule.directoryOnly && !isDirectory) {
    return false;
  }
  const segments = normalizedPath.split('/');
  const candidate = rule.pattern.includes('/') || rule.anchored ? normalizedPath : segments.at(-1);
  return rule.regex.test(candidate);
}

function lastMatchingRuleIgnores(rules, normalizedPath, isDirectory) {
  let ignored = false;
  for (const rule of rules) {
    if (ruleMatchesEntry(rule, normalizedPath, isDirectory)) {
      ignored = !rule.negated;
    }
  }
  return ignored;
}

function isIgnored(relativePath, rules) {
  const normalizedPath = relativePath.replaceAll('\\', '/').replace(/\/$/u, '');
  const segments = normalizedPath.split('/');
  if (segments.some((segment) => ignoredDirectories.has(segment))) {
    return true;
  }
  // 祖先ディレクトリが除外されると、その中のファイルはGitの否定規則でも戻らない。
  for (let index = 1; index < segments.length; index += 1) {
    const ancestor = segments.slice(0, index).join('/');
    if (lastMatchingRuleIgnores(rules, ancestor, true)) {
      return true;
    }
  }
  return lastMatchingRuleIgnores(rules, normalizedPath, false);
}

function collectFilesystemTextPaths(root, directory, rules) {
  const paths = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const relativePath = relative(root, path);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        paths.push(...collectFilesystemTextPaths(root, path, rules));
      }
    } else if ((entry.isFile() || entry.isSymbolicLink()) && !isIgnored(relativePath, rules)) {
      // Gitはシンボリックリンクも追跡対象にする。参照先を読み、壊れたリンクは例外で止めて検査を失敗させる。
      const content = readFileSync(path);
      if (!content.includes(0)) {
        paths.push(relativePath);
      }
    }
  }
  return paths;
}

function collectGitTextPaths(root) {
  return execFileSync(
    'git',
    ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  )
    .split('\0')
    .filter((path) => path.length > 0)
    .filter((path) => !readFileSync(join(root, path)).includes(0));
}

export function collectPublicTextPaths(root) {
  // Gitリポジトリでは、Gitの追跡対象を唯一の正本にする。
  // 取得に失敗したときに固定除外のフォールバックへ切り替えると、検査対象を取り漏らすため失敗させる。
  if (existsSync(join(root, '.git'))) {
    return collectGitTextPaths(root);
  }
  return collectFilesystemTextPaths(root, root, readIgnoreRules(root));
}

export function readPublicText(root) {
  return collectPublicTextPaths(root)
    .map((path) => `${path}\n${readFileSync(join(root, path), 'utf8')}`)
    .join('\n');
}
