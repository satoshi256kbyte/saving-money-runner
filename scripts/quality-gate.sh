#!/bin/sh
# 変更範囲に応じた品質ゲートを1つの入口から実行する。
# AGENTS.mdの「コミット前の品質ゲート」の表に対応する。
# 手作業でゲートを組み立てると実行漏れが起きるため、この入口に集約する。
set -eu

base_ref="${QUALITY_GATE_BASE:-origin/main}"
repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

# 基点が解決できない場合は、比較を省いて成功にせず停止する。
if ! git rev-parse --verify -q "$base_ref" >/dev/null 2>&1; then
  printf 'FAILED: 基点 %s が解決できない。git fetch origin main を実行するか QUALITY_GATE_BASE を指定する\n' \
    "$base_ref" >&2
  exit 1
fi

# 依存が未導入の場合は成功扱いにせず停止する。
if [ ! -d node_modules ]; then
  printf '%s\n' 'FAILED: node_modulesが未導入。corepack pnpm install を実行する' >&2
  exit 1
fi

# 各gitを個別の代入で実行する。パイプラインにすると、gitの失敗が後段の終了コードに隠れ、
# 変更が欠けたままゲートが通ってしまうため。
# リネームを検出させず、旧パスも変更として扱う。新パスだけだと、旧パスの変更を見落とすため。
committed=$(git -c core.quotepath=off diff --no-renames --name-only "$base_ref"...HEAD)
staged=$(git -c core.quotepath=off diff --cached --no-renames --name-only)
unstaged=$(git -c core.quotepath=off diff --no-renames --name-only)
untracked=$(git -c core.quotepath=off ls-files --others --exclude-standard)
changed=$(printf '%s\n%s\n%s\n%s\n' "$committed" "$staged" "$unstaged" "$untracked" | sort -u | sed '/^$/d')

printf '%s\n' "$changed" | sed 's/^/変更: /'

# ドキュメントだけの変更は、Markdownの検査と差分の検査だけで足りる。
# それ以外（設定、スクリプト、テスト、CDK、依存）は、全体のゲートを実行する。
# 変更が空のときは判定できないため、ドキュメントのみとはみなさず全体のゲートを実行する。
docs_only=1
if [ -z "$changed" ]; then
  docs_only=0
else
  # docs:checkが検査する場所のMarkdownだけを、ドキュメントの変更とみなす。
  while IFS= read -r path; do
    if ! printf '%s\n' "$path" | grep -Eq '^(AGENTS\.md|README\.md|(docs|specs)/.*\.md)$'; then
      docs_only=0
    fi
  done <<EOF_CHANGED
$changed
EOF_CHANGED
fi

status=0
run() {
  printf '==> %s\n' "$*"
  if ! "$@"; then
    printf 'FAILED: %s\n' "$*" >&2
    status=1
  fi
}

run git diff --check
run git diff --cached --check
run git -c core.quotepath=off diff --check "$base_ref"...HEAD

if [ "$docs_only" -eq 1 ]; then
  printf '%s\n' '変更範囲: ドキュメントのみ'
  # 公開情報の検査はNodeだけで動き、文書に混入した識別情報や秘密値を検出するため省かない。
  run corepack pnpm docs:check
  run corepack pnpm security:check
else
  printf '%s\n' '変更範囲: 設定、コード、テスト、CDKのいずれかを含む'
  run corepack pnpm quality
fi

if [ "$status" -eq 0 ]; then
  printf '%s\n' 'quality-gate: passed'
else
  printf '%s\n' 'quality-gate: failed' >&2
fi
exit "$status"
