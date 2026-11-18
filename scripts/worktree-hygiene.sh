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
# 归档落在 <主检出>/.worktrees/_archive/<日期>/（该目录已被 .gitignore 忽略）。
# 想长期保留某棵树，把分支名或路径写进 <主检出>/.worktrees/_keep.txt（一行一个）。
set -uo pipefail

MAIN="$(git worktree list --porcelain | sed -n '1s/^worktree //p')"
CURRENT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
ARCHIVE_BASE="$MAIN/.worktrees/_archive/$(date +%Y-%m-%d)"
KEEP_FILE="$MAIN/.worktrees/_keep.txt"

norm() { (cd "$1" 2>/dev/null && pwd -P) | tr '[:upper:]' '[:lower:]'; }
MAIN_N="$(norm "$MAIN")"
CURRENT_N="$(norm "$CURRENT")"

# 开放 PR 的 head 分支 → 编号，一次 gh 调用，失败则留空
OPEN_PRS=""
if command -v gh >/dev/null 2>&1; then
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
  git worktree list --porcelain | awk '
    /^worktree /{w=substr($0,10)}
    /^HEAD /{h=substr($0,6)}
    /^branch /{b=substr($0,8); sub("refs/heads/","",b)}
    /^detached/{b="(detached)"}
    /^$/{if(w)print w"\t"h"\t"b; w=""}
    END{if(w)print w"\t"h"\t"b}'
}

reachable() { [ -n "$(git -C "$1" branch -r --contains "$2" 2>/dev/null | grep -v '\->' | head -1)" ]; }

age_days() {
  local ts now
  ts="$(git -C "$1" log -1 --format=%ct 2>/dev/null)" || { echo "?"; return; }
  now="$(date +%s)"
  echo $(( (now - ts) / 86400 ))
}

classify() {
  # $1=path $2=head $3=branch → 建议
  local p="$1" h="$2" b="$3" pn
  if [ "$(norm "$p")" = "$MAIN_N" ]; then echo "KEEP:main"; return; fi
  if [ "$(norm "$p")" = "$CURRENT_N" ]; then echo "KEEP:current"; return; fi
  if keep_for "$b" "$p"; then echo "KEEP:keep-list"; return; fi
  pn="$(pr_for "$b")"
  if [ -n "$pn" ]; then echo "KEEP:open-pr#$pn"; return; fi
  if [ "$(git -C "$p" status --porcelain 2>/dev/null | wc -l)" -gt 0 ]; then echo "ARCHIVE:dirty"; return; fi
  reachable "$p" "$h" || { echo "HOLD:unique-commits"; return; }
  echo "SAFE"
}

archive_worktree() {
  local p="$1" name dir
  name="$(basename "$p")"
  dir="$ARCHIVE_BASE"
  mkdir -p "$dir"
  git -C "$p" diff --binary HEAD > "$dir/$name.patch" 2>/dev/null
  {
    echo "path: $p"
    echo "branch: $(git -C "$p" rev-parse --abbrev-ref HEAD 2>/dev/null)"
    echo "head: $(git -C "$p" rev-parse HEAD 2>/dev/null)"
    echo "archived: $(date +%F)"
    echo "status:"
    git -C "$p" status --porcelain
  } > "$dir/$name.meta.txt"
  if [ -n "$(git -C "$p" ls-files --others --exclude-standard 2>/dev/null | head -1)" ]; then
    git -C "$p" ls-files -z --others --exclude-standard > "$dir/$name.untracked.list"
    tar -czf "$dir/$name-untracked.tar.gz" -C "$p" --null -T "$dir/$name.untracked.list"
    rm -f "$dir/$name.untracked.list"
  fi
  echo "  已归档到 $dir/$name.*"
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
  local removed=0
  while IFS=$'\t' read -r p h b; do
    local rec; rec="$(classify "$p" "$h" "$b")"
    local age; age="$(age_days "$p")"
    local old_enough=1
    case "$age" in ''|'?') old_enough=0 ;; *) [ "$age" -ge "$min_age" ] || old_enough=0 ;; esac
    case "$rec" in
      SAFE)
        echo "删除 $p ($b)"
        [ "$apply" = 1 ] && git worktree remove "$p" ;;
      ARCHIVE:*)
        if [ "$archive_dirty" != 1 ]; then
          echo "跳过（有未提交内容，加 --archive-dirty）: $p"
        elif [ "$old_enough" != 1 ]; then
          echo "跳过（HEAD 仅 ${age} 天，--older-than ${min_age}）: $p"
        else
          echo "归档后删除 $p ($b)"
          if [ "$apply" = 1 ]; then archive_worktree "$p" && git worktree remove --force "$p"; fi
        fi ;;
      HOLD:*)
        if [ "$drop_unique" != 1 ]; then
          echo "保留（有独有提交）: $p"
        elif [ "$old_enough" != 1 ]; then
          echo "跳过（HEAD 仅 ${age} 天，--older-than ${min_age}）: $p"
        else
          echo "归档后删除 $p ($b，含独有提交)"
          if [ "$apply" = 1 ]; then archive_worktree "$p" && git worktree remove --force "$p"; fi
        fi ;;
      KEEP:*)
        echo "保留（${rec#KEEP:}）: $p" ;;
    esac
    removed=$((removed + 1))
  done < <(worktrees)
  [ "$apply" = 1 ] && git worktree prune && echo "已 prune"
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
  *) sed -n '2,20p' "$0"; exit 2 ;;
esac
