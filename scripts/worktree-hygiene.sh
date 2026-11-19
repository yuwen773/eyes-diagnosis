#!/usr/bin/env bash
# 工作树卫生普查与回收。
#
#   scripts/worktree-hygiene.sh report                 # 只读：列出每棵树的状态与建议
#   scripts/worktree-hygiene.sh report --size          # 附带磁盘占用（慢）
#   scripts/worktree-hygiene.sh reap                   # 干跑：只说会做什么
#   scripts/worktree-hygiene.sh reap --apply           # 只删「干净 + 提交都在远端」的树
#   scripts/worktree-hygiene.sh reap --archive-dirty --apply
#                                                      # 有未提交内容的先打包再删
#   scripts/worktree-hygiene.sh reap --drop-unique --apply
#                                                      # 连有独有提交的也删（先打包）
#   scripts/worktree-hygiene.sh reap --archive-dirty --older-than 7 --apply
#                                                      # 只动 HEAD 已 7 天没更新的
#   scripts/worktree-hygiene.sh branches               # 只读：列出可安全删除的本地分支
#   scripts/worktree-hygiene.sh branches --apply
#
# 永不触碰：主检出、当前工作树、分支挂着开放 PR 的工作树、_keep.txt 里登记的分支/路径。
# 归档落在 <主检出>/.worktrees/_archive/<日期>/<树名>-<HEAD短SHA>/（该目录已被 .gitignore 忽略）：
#   changes.patch / index.patch / worktree.patch / meta.txt / untracked.tar.gz / history.bundle。
# **归档任何一步失败都不会删除工作树**；同名同日归档不会互相覆盖。
# 想长期保留某棵树，把分支名或路径写进 <主检出>/.worktrees/_keep.txt（一行一个）。
#
# 环境变量（回归脚本用，正常使用无需设置）：
#   IRIS_ARCHIVE_BASE   覆盖归档根目录
#   IRIS_NO_PR_LOOKUP=1 不查 GitHub 开放 PR
set -uo pipefail

WORKTREE_LIST="$(git worktree list --porcelain)" || exit 1
MAIN="$(printf '%s\n' "$WORKTREE_LIST" | sed -n '1s/^worktree //p')"
CURRENT="$(git rev-parse --show-toplevel)" || exit 1
[ -n "$MAIN" ] && [ -n "$CURRENT" ] || exit 1
# 归档目录可用环境变量覆盖：回归脚本要把它指到临时目录。
ARCHIVE_BASE="${IRIS_ARCHIVE_BASE:-$MAIN/.worktrees/_archive/$(date +%Y-%m-%d)}"
KEEP_FILE="$MAIN/.worktrees/_keep.txt"

norm() { (cd "$1" 2>/dev/null && pwd -P) | tr '[:upper:]' '[:lower:]'; }
MAIN_N="$(norm "$MAIN")"
CURRENT_N="$(norm "$CURRENT")"

# 开放 PR 的 head 分支 → 编号，一次 gh 调用，失败则留空。
# IRIS_NO_PR_LOOKUP=1 用于离线/回归环境：不查 PR 时一切按「没有开放 PR」处理。
OPEN_PRS=""
if [ -z "${IRIS_NO_PR_LOOKUP:-}" ] && command -v gh >/dev/null 2>&1; then
  OPEN_PRS="$(gh pr list --state open --limit 200 --json headRefName,number \
    --jq '.[] | "\(.headRefName)\t\(.number)"' 2>/dev/null)"
fi
pr_for() { printf '%s\n' "$OPEN_PRS" | awk -F'\t' -v b="$1" '$1==b{print $2; exit}'; }

# _keep.txt 里可以写分支名或绝对路径，一行一个
keep_for() {
  [ -f "$KEEP_FILE" ] || return 1
  grep -qxF -- "$1" "$KEEP_FILE" 2>/dev/null && return 0
  grep -qxF -- "$2" "$KEEP_FILE" 2>/dev/null && return 0
  return 1
}

worktrees() {
  printf '%s\n' "$WORKTREE_LIST" | awk '
    /^worktree /{w=substr($0,10)}
    /^HEAD /{h=substr($0,6)}
    /^branch /{b=substr($0,8); sub("refs/heads/","",b)}
    /^detached/{b="(detached)"}
    /^$/{if(w)print w"\t"h"\t"b; w=""}
    END{if(w)print w"\t"h"\t"b}'
}

reachable() {
  local refs
  refs="$(git -C "$1" branch -r --contains "$2")" || return 2
  [ -n "$(printf '%s\n' "$refs" | grep -v '\->')" ]
}

age_days() {
  local ts now
  ts="$(git -C "$1" log -1 --format=%ct)" || return 1
  [[ "$ts" =~ ^[0-9]+$ ]] || return 1
  now="$(date +%s)" || return 1
  echo $(( (now - ts) / 86400 ))
}

classify() {
  # $1=path $2=head $3=branch → 建议
  local p="$1" h="$2" b="$3" pn dirty=0 unique=0 status others diff_rc current_head current_branch
  if [ "$(norm "$p")" = "$MAIN_N" ]; then echo "KEEP:main"; return; fi
  if [ "$(norm "$p")" = "$CURRENT_N" ]; then echo "KEEP:current"; return; fi
  if keep_for "$b" "$p"; then echo "KEEP:keep-list"; return; fi
  pn="$(pr_for "$b")"
  if [ -n "$pn" ]; then echo "KEEP:open-pr#$pn"; return; fi
  case "$b" in master|main|ui) echo "KEEP:protected-branch"; return;; esac
  current_head="$(git -C "$p" rev-parse HEAD)" || return 1
  [[ "$current_head" =~ ^[0-9a-f]{40}$ ]] && [ "$current_head" = "$h" ] || return 1
  current_branch="$(git -C "$p" rev-parse --abbrev-ref HEAD)" || return 1
  [ -n "$current_branch" ] || return 1
  if [ "$b" = '(detached)' ]; then
    [ "$current_branch" = HEAD ] || return 1
  else
    [ "$current_branch" = "$b" ] || return 1
  fi
  status="$(git -C "$p" status --porcelain)" || return 1
  others="$(git -C "$p" ls-files --others --exclude-standard)" || return 1
  git -C "$p" diff --quiet HEAD --; diff_rc=$?
  [ "$diff_rc" -le 1 ] || return 1
  if [ -n "$status" ] || [ -n "$others" ] || [ "$diff_rc" = 1 ]; then dirty=1; fi
  # 空输出不能把真实改动重新归类为 SAFE。
  if [ -z "$status" ] && { [ -n "$others" ] || [ "$diff_rc" = 1 ]; }; then return 1; fi
  reachable "$p" "$h"; local reachable_rc=$?
  [ "$reachable_rc" -le 1 ] || return 1
  [ "$reachable_rc" = 0 ] || unique=1
  # 脏且唯一必须单独标出来：只加 --archive-dirty 的树也可能有独有提交，
  # 那种情况不能靠 diff 补丁 + 文件包宣称保全了历史（要 Git bundle）。
  if [ "$dirty" = 1 ] && [ "$unique" = 1 ]; then echo "ARCHIVE:dirty+unique"; return; fi
  if [ "$dirty" = 1 ]; then echo "ARCHIVE:dirty"; return; fi
  if [ "$unique" = 1 ]; then echo "HOLD:unique-commits"; return; fi
  echo "SAFE"
}

# ---------------------------------------------------------------------------
# 归档：任何一步失败都必须 fail-closed —— 返回非零，调用方据此放弃删除。
#
# 旧实现把所有失败都吞掉，最后一句 `echo 已归档` 才是函数的退出状态，
# 所以 tar 失败、磁盘满、diff 写不进去时函数照样返回 0，调用方照删不误。
# 现在每一步都显式检查；归档先写临时目录，校验通过后再原子改名发布。
#
# 用法：archive_worktree <路径>；归档始终自包含，并在隔离仓库验证实际恢复。
# ---------------------------------------------------------------------------
# 快照同时覆盖暂存区、工作区和未跟踪文件的实际字节。NUL 分隔支持换行文件名。
snapshot_worktree() {
  local p="$1" out="$2" f hash head
  mkdir -p "$out" || return 1
  head="$(git -C "$p" rev-parse HEAD)" || return 1
  [[ "$head" =~ ^[0-9a-f]{40}$ ]] || return 1
  printf '%s\n' "$head" > "$out/head" || return 1
  git -C "$p" status --porcelain -z > "$out/status" || return 1
  git -C "$p" ls-files --stage -z > "$out/index" || return 1
  git -C "$p" ls-files -z --cached --others --exclude-standard > "$out/files.raw" || return 1
  sort -zu "$out/files.raw" > "$out/files" || return 1
  : > "$out/content" || return 1
  while IFS= read -r -d '' f; do
    if [ -L "$p/$f" ]; then
      hash="$(readlink "$p/$f" | git hash-object --stdin)" || return 1
      printf 'link\0%s\0%s\0' "$f" "$hash" >> "$out/content" || return 1
    elif [ -f "$p/$f" ]; then
      hash="$(git -C "$p" hash-object --no-filters -- "$f")" || return 1
      [[ "$hash" =~ ^[0-9a-f]{40}$ ]] || return 1
      printf 'file\0%s\0%s\0' "$f" "$hash" >> "$out/content" || return 1
    elif [ ! -e "$p/$f" ]; then
      printf 'missing\0%s\0' "$f" >> "$out/content" || return 1
    else
      # 子模块、设备文件等不具备本脚本支持的恢复证明，保守保留。
      return 1
    fi
  done < "$out/files"
}

same_snapshot() {
  local a="$1" b="$2" part
  for part in head status index files content; do
    cmp -s "$a/$part" "$b/$part" || return 1
  done
}

# 只回收本次验证创建、且确实位于归档目录内的临时检出/清单。
remove_verification_dir() {
  local target parent
  target="$(cd "$1" && pwd -P)" || return 1
  parent="$(cd "$2" && pwd -P)" || return 1
  case "$target" in
    "$parent"/restore.*|"$parent"/after.*|"$parent"/pre-remove.*) rm -rf -- "$target" ;;
    *) return 1 ;;
  esac
}

# 不能用 verify 或 tar 条目数作为可恢复证明：在全新仓库真正重建两个工作版本。
restore_archive() {
  local archive="$1" restore="$2" head="$3"
  git init -q "$restore" || return 1
  git -C "$restore" config core.autocrlf false || return 1
  git -C "$restore" bundle verify "$archive/history.bundle" >/dev/null 2>&1 || return 1
  git -C "$restore" bundle unbundle "$archive/history.bundle" >/dev/null 2>&1 || return 1
  git -C "$restore" fsck --full --no-reflogs "$head" >/dev/null 2>&1 || return 1
  git -C "$restore" checkout -q --detach "$head" || return 1
  if [ -s "$archive/index.patch" ]; then
    git -C "$restore" apply --binary --index "$archive/index.patch" || return 1
  fi
  if [ -s "$archive/worktree.patch" ]; then
    git -C "$restore" apply --binary "$archive/worktree.patch" || return 1
  fi
  tar -xzf "$archive/untracked.tar.gz" -C "$restore" || return 1
  snapshot_worktree "$restore" "$restore/.git/restored-snapshot" || return 1
  same_snapshot "$archive/snapshot" "$restore/.git/restored-snapshot"
}

ARCHIVED_PATH=""
ARCHIVE_DIGEST=""
archive_digest() {
  (cd "$1" && sha256sum history.bundle index.patch worktree.patch changes.patch \
    untracked.tar.gz meta.txt branch snapshot/head snapshot/status snapshot/index snapshot/files snapshot/content)
}
archive_worktree() {
  local p="$1" name head branch staging final restore after
  ARCHIVED_PATH=""
  ARCHIVE_DIGEST=""
  name="$(basename "$p")"
  head="$(git -C "$p" rev-parse HEAD)" || return 1
  [[ "$head" =~ ^[0-9a-f]{40}$ ]] || return 1
  branch="$(git -C "$p" rev-parse --abbrev-ref HEAD)" || return 1
  [ -n "$branch" ] || return 1
  final="$ARCHIVE_BASE/$name-${head:0:8}"
  [ ! -e "$final" ] || { echo "归档失败：目标已存在: $final" >&2; return 1; }
  mkdir -p "$ARCHIVE_BASE" || return 1
  staging="$(mktemp -d "$final.staging.XXXXXX")" || return 1

  _archive_abort() {
    echo "归档失败：$1 —— 工作树已保留: $p；临时证据: $staging" >&2
    return 1
  }
  snapshot_worktree "$p" "$staging/snapshot" || { _archive_abort "无法读取完整快照"; return 1; }
  [ "$(cat "$staging/snapshot/head")" = "$head" ] || return 1
  git -C "$p" diff --binary HEAD > "$staging/changes.patch" || { _archive_abort "git diff 失败"; return 1; }
  git -C "$p" diff --binary --cached HEAD > "$staging/index.patch" || return 1
  git -C "$p" diff --binary > "$staging/worktree.patch" || return 1
  git -C "$p" ls-files -z --others --exclude-standard > "$staging/untracked.list" || return 1
  tar -czf "$staging/untracked.tar.gz" -C "$p" --null -T "$staging/untracked.list" || { _archive_abort "未跟踪文件打包失败"; return 1; }
  tar -tzf "$staging/untracked.tar.gz" > "$staging/untracked.toc" || return 1
  # 所有归档自包含，不依赖原仓库仍然存在或远端未来仍可达。
  git -C "$p" bundle create "$staging/history.bundle" "$head" HEAD >/dev/null 2>&1 || return 1
  git -C "$p" bundle verify "$staging/history.bundle" >/dev/null 2>&1 || return 1
  {
    printf 'path: %s\nbranch: %s\nhead: %s\narchived: %s\n' "$p" "$branch" "$head" "$(date +%F)"
    git -C "$p" status --porcelain
  } > "$staging/meta.txt" || return 1
  printf '%s\n' "$branch" > "$staging/branch" || return 1

  restore="$(mktemp -d "$staging/restore.XXXXXX")" || return 1
  restore_archive "$staging" "$restore" "$head" || { _archive_abort "隔离仓库恢复校验失败"; return 1; }
  # 仅删除本函数在归档暂存目录内创建的恢复检出。
  remove_verification_dir "$restore" "$staging" || return 1
  after="$(mktemp -d "$staging/after.XXXXXX")" || return 1
  snapshot_worktree "$p" "$after" && same_snapshot "$staging/snapshot" "$after" || { _archive_abort "归档期间内容变化"; return 1; }
  remove_verification_dir "$after" "$staging" || return 1
  mv "$staging" "$final" || return 1
  # 原子发布后的内容也必须能够从零恢复；失败保留已发布工件供调查。
  restore="$(mktemp -d "$final/restore.XXXXXX")" || return 1
  restore_archive "$final" "$restore" "$head" || { echo "归档失败：发布后恢复失败 $final" >&2; return 1; }
  remove_verification_dir "$restore" "$final" || return 1
  ARCHIVE_DIGEST="$(archive_digest "$final")" || return 1
  ARCHIVED_PATH="$final"
  echo "  已归档并验证真实恢复: $final"
}

# 删除前最后一道确认：重新分类，结果与预期不符就不删。
# 树在归档期间可能被别的 Agent 重新占用（新建分支、加未提交内容、开 PR）。
remove_worktree_if_still_expected() {
  local p="$1" h="$2" b="$3" expected="$4" rec snapshot branch digest
  rec="$(classify "$p" "$h" "$b")" || return 1
  if [ "$rec" != "$expected" ]; then
    echo "拒绝删除：$p 状态已从 $expected 变为 $rec" >&2
    return 1
  fi
  if [ "$expected" != SAFE ]; then
    [ -n "$ARCHIVED_PATH" ] && [ -d "$ARCHIVED_PATH" ] || return 1
    digest="$(archive_digest "$ARCHIVED_PATH")" || return 1
    [ -n "$ARCHIVE_DIGEST" ] && [ "$digest" = "$ARCHIVE_DIGEST" ] || return 1
    branch="$(git -C "$p" rev-parse --abbrev-ref HEAD)" || return 1
    [ "$branch" = "$(cat "$ARCHIVED_PATH/branch")" ] || return 1
    snapshot="$(mktemp -d "$ARCHIVED_PATH/pre-remove.XXXXXX")" || return 1
    if ! snapshot_worktree "$p" "$snapshot" || ! same_snapshot "$ARCHIVED_PATH/snapshot" "$snapshot"; then
      echo "拒绝删除：归档后工作树内容发生变化或无法读取（$p）" >&2
      return 1
    fi
    remove_verification_dir "$snapshot" "$ARCHIVED_PATH" || return 1
  fi
  if ! git worktree remove --force "$p"; then
    echo "删除失败：git worktree remove 返回非零（$p）" >&2
    return 1
  fi
  return 0
}

cmd_report() {
  local size=0; [ "${1:-}" = "--size" ] && size=1
  printf '%-58s %-38s %-16s %5s %5s  %s\n' "路径" "分支" "HEAD" "脏" "天" "建议"
  while IFS=$'\t' read -r p h b; do
    local d a rec mb=""
    d="$(git -C "$p" status --porcelain 2>/dev/null | wc -l)"
    a="$(age_days "$p")"
    rec="$(classify "$p" "$h" "$b")"
    [ "$size" = 1 ] && mb="$(du -sm "$p" 2>/dev/null | cut -f1)MB"
    printf '%-58s %-38s %-16s %5s %5s  %s %s\n' "$p" "$b" "$(printf '%s' "$h" | cut -c1-8)" "$d" "$a" "$rec" "$mb"
  done < <(worktrees)
}

cmd_reap() {
  local apply=0 archive_dirty=0 drop_unique=0 min_age=3
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --apply) apply=1 ;;
      --archive-dirty) archive_dirty=1 ;;
      --drop-unique) drop_unique=1 ;;
      --older-than) shift; min_age="${1:-3}" ;;
      *) echo "未知参数: $1" >&2; exit 2 ;;
    esac
    shift
  done
  [ "$apply" = 0 ] && echo "（干跑。加 --apply 才真正删除）"
  local removed=0 failures=0
  while IFS=$'\t' read -r p h b; do
    local rec
    if ! rec="$(classify "$p" "$h" "$b")"; then
      echo "无法确认工作树状态，已保留: $p" >&2
      failures=$((failures + 1))
      continue
    fi
    local age
    if ! age="$(age_days "$p")"; then
      echo "无法确认工作树年龄，已保留: $p" >&2
      failures=$((failures + 1))
      continue
    fi
    local old_enough=1
    case "$age" in ''|'?') old_enough=0 ;; *) [ "$age" -ge "$min_age" ] || old_enough=0 ;; esac
    case "$rec" in
      SAFE)
        echo "删除 $p ($b)"
        if [ "$apply" = 1 ]; then
          remove_worktree_if_still_expected "$p" "$h" "$b" "$rec"             || { echo "已跳过: $p" >&2; failures=$((failures + 1)); }
        fi ;;
      ARCHIVE:*)
        local need_history=0
        [ "$rec" = "ARCHIVE:dirty+unique" ] && need_history=1
        if [ "$archive_dirty" != 1 ]; then
          echo "跳过（有未提交内容，加 --archive-dirty）: $p"
        elif [ "$need_history" = 1 ] && [ "$drop_unique" != 1 ]; then
          echo "保留（还有独有提交，加 --drop-unique 才会删）: $p"
        elif [ "$old_enough" != 1 ]; then
          echo "跳过（HEAD 仅 ${age} 天，--older-than ${min_age}）: $p"
        else
          echo "归档后删除 $p ($b)"
          if [ "$apply" = 1 ]; then
            # 归档是删除的前提：归档失败（返回非零）时绝不继续删。
            if archive_worktree "$p" "$need_history"; then
              remove_worktree_if_still_expected "$p" "$h" "$b" "$rec"                 || { echo "已跳过: $p" >&2; failures=$((failures + 1)); }
            else
              echo "归档未完成，已保留工作树: $p" >&2
              failures=$((failures + 1))
            fi
          fi
        fi ;;
      HOLD:*)
        if [ "$drop_unique" != 1 ]; then
          echo "保留（有独有提交）: $p"
        elif [ "$old_enough" != 1 ]; then
          echo "跳过（HEAD 仅 ${age} 天，--older-than ${min_age}）: $p"
        else
          echo "归档后删除 $p ($b，含独有提交)"
          if [ "$apply" = 1 ]; then
            # 独有提交必须由 bundle 保全并通过隔离恢复，才允许删除。
            if archive_worktree "$p" 1; then
              remove_worktree_if_still_expected "$p" "$h" "$b" "$rec"                 || { echo "已跳过: $p" >&2; failures=$((failures + 1)); }
            else
              echo "归档未完成，已保留工作树: $p" >&2
              failures=$((failures + 1))
            fi
          fi
        fi ;;
      KEEP:*)
        echo "保留（${rec#KEEP:}）: $p" ;;
    esac
    removed=$((removed + 1))
  done < <(worktrees)
  if [ "$apply" = 1 ]; then
    git worktree prune && echo "已 prune"
  fi
  # 有任何归档/删除失败就以非零退出：调用方（人和脚本）都该看到「这轮没清净」。
  [ "$failures" = 0 ] || return 1
}

cmd_branches() {
  local apply=0; [ "${1:-}" = "--apply" ] && apply=1
  [ "$apply" = 0 ] && echo "（干跑。加 --apply 才真正删除）"
  local checked cur
  cur="$(git rev-parse --abbrev-ref HEAD)"
  checked="$(git worktree list --porcelain | sed -n 's/^branch refs\/heads\///p')"
  while read -r b; do
    [ "$b" = "$cur" ] && continue
    case "$b" in master|main|ui) echo "保留（主干分支）: $b"; continue ;; esac
    case $'\n'"$checked"$'\n' in *$'\n'"$b"$'\n'*) continue ;; esac
    [ -n "$(pr_for "$b")" ] && { echo "保留（开放 PR #$(pr_for "$b")）: $b"; continue; }
    keep_for "$b" "" && { echo "保留（keep-list）: $b"; continue; }
    local ahead_ui ahead_master
    ahead_ui="$(git rev-list --count "$b" ^origin/ui 2>/dev/null || echo 999999)"
    ahead_master="$(git rev-list --count "$b" ^origin/master 2>/dev/null || echo 999999)"
    if [ "$ahead_ui" = 0 ] || [ "$ahead_master" = 0 ]; then
      echo "删除 $b（已并入 $([ "$ahead_ui" = 0 ] && echo ui || echo master)）"
      [ "$apply" = 1 ] && git branch -D "$b" >/dev/null
    else
      echo "保留（独有提交 ui+$ahead_ui / master+$ahead_master）: $b"
    fi
  done < <(git for-each-ref --format='%(refname:short)' refs/heads)
}

case "${1:-}" in
  report) shift; cmd_report "$@" ;;
  reap) shift; cmd_reap "$@" ;;
  branches) shift; cmd_branches "$@" ;;
  *) sed -n '2,24p' "$0"; exit 2 ;;
esac
