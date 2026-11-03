#!/bin/sh
# レビュー用のGit管理下スナップショットを、サブエージェントが読める共有の一時領域に作る。
# 手作業の複製では、古い基点を参照して変更が欠落する事故が起きたため、この手順に集約する。
set -eu

if [ "$#" -ne 1 ]; then
  printf '%s\n' '使い方: sh scripts/review-snapshot.sh <レビュー名>' >&2
  exit 2
fi

name="$1"
case "$name" in
  *[!A-Za-z0-9._-]*|'') printf '%s\n' 'レビュー名は英数字、ドット、アンダースコア、ハイフンだけ使う' >&2; exit 2 ;;
esac

repo_root=$(git rev-parse --show-toplevel)
repo_name=$(basename "$repo_root")
# サブエージェントは$KIROCREW_SCRATCHを読める。$TMPDIRは実行プロセスごとの領域なので使わない。
snapshot_root="${REVIEW_SNAPSHOT_ROOT:-${KIROCREW_SCRATCH:-$HOME/workplace}}"
snapshot_dir="$snapshot_root/$repo_name-review-$name"

if [ -e "$snapshot_dir" ]; then
  printf 'スナップショットが既に存在する: %s\n' "$snapshot_dir" >&2
  printf '%s\n' '再利用せず、別のレビュー名を指定する' >&2
  exit 2
fi

mkdir -p "$snapshot_root"
git clone -q --no-local "$repo_root" "$snapshot_dir"

# 実リモートへの経路を断つ。スナップショット内からpushしても届かないようにする。
git -C "$snapshot_dir" remote remove origin

# HEADが追跡しているシンボリックリンクは、リポジトリ外を指す可能性があるため取り除く（mode 120000）。
# 非ASCII名のパスが引用符付きで出ると、削除対象を取り違えるため、パスの引用を無効にする。
links=$(git -c core.quotepath=off -C "$snapshot_dir" ls-files -s)
tab=$(printf '\t')
while IFS= read -r entry; do
  [ -n "$entry" ] || continue
  case "$entry" in
    120000\ *) rm -f "$snapshot_dir/${entry#*"$tab"}" ;;
  esac
done <<EOF_LINKS
$links
EOF_LINKS

# 作業ツリーの変更（ステージ済み・未ステージ・未追跡）を、HEADの上に重ねる。
# gitの失敗をパイプラインの終了コードに隠さないため、各コマンドを個別に代入する。
# リネームを検出させず、旧パスも重ねる対象にする。新パスだけだと、旧パスの削除が反映されないため。
staged=$(git -c core.quotepath=off -C "$repo_root" diff --cached --no-renames --name-only)
unstaged=$(git -c core.quotepath=off -C "$repo_root" diff --no-renames --name-only)
untracked=$(git -c core.quotepath=off -C "$repo_root" ls-files --others --exclude-standard)
list="$snapshot_dir/.review-changed.txt"
printf '%s\n%s\n%s\n' "$staged" "$unstaged" "$untracked" | sort -u > "$list"

while IFS= read -r path; do
  [ -n "$path" ] || continue
  src="$repo_root/$path"
  dst="$snapshot_dir/$path"

  # コピー先の祖先にシンボリックリンクがあると、書き込みがスナップショット外へ抜けるため拒否する。
  ancestor=$(dirname "$dst")
  while [ "$ancestor" != "$snapshot_dir" ] && [ "$ancestor" != "/" ]; do
    if [ -L "$ancestor" ]; then
      printf 'FAILED: コピー先の祖先がシンボリックリンク: %s\n' "$ancestor" >&2
      exit 1
    fi
    ancestor=$(dirname "$ancestor")
  done

  if [ -L "$src" ]; then
    # リポジトリ外を指す可能性があるため、リンク先の内容はコピーしない。
    printf 'WARNING: シンボリックリンクはスナップショットに含めない: %s\n' "$path" >&2
    rm -f "$dst"
  elif [ -f "$src" ]; then
    mkdir -p "$(dirname "$dst")"
    # 既存のリンクを辿って書き込まないよう、先に削除してから新しく作る。
    # cp -pで実行権限を保ち、レビュアーがスナップショットで実行したときに失敗しないようにする。
    rm -f "$dst"
    cp -p "$src" "$dst"
  else
    rm -f "$dst"
  fi
done < "$list"

rm -f "$list"

printf 'スナップショット: %s\n' "$snapshot_dir"
printf 'HEAD: %s\n' "$(git -C "$snapshot_dir" rev-parse --short HEAD)"
git -C "$snapshot_dir" status --short
