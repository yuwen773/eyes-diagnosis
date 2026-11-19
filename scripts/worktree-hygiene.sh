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
#   changes.patch（已跟踪改动）/ meta.txt / untracked.tar.gz / history.bundle（有独有提交时）。
# **归档任何一步失败都不会删除工作树**；同名同日归档不会互相覆盖。
# 想长期保留某棵树，把分支名或路径写进 <主检出>/.worktrees/_keep.txt（一行一个）。
#
# 环境变量（回归脚本用，正常使用无需设置）：
#   IRIS_ARCHIVE_BASE   覆盖归档根目录
#   IRIS_NO_PR_LOOKUP=1 不查 GitHub 开放 PR
set -uo pipefail

MAIN="$(git worktree list --porcelain | sed -n '1s/^worktree //p')"
CURRENT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
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
  local p="$1" h="$2" b="$3" pn dirty=0 unique=0
  if [ "$(norm "$p")" = "$MAIN_N" ]; then echo "KEEP:main"; return; fi
  if [ "$(norm "$p")" = "$CURRENT_N" ]; then echo "KEEP:current"; return; fi
  if keep_for "$b" "$p"; then echo "KEEP:keep-list"; return; fi
  pn="$(pr_for "$b")"
  if [ -n "$pn" ]; then echo "KEEP:open-pr#$pn"; return; fi
  [ "$(git -C "$p" status --porcelain 2>/dev/null | wc -l)" -gt 0 ] && dirty=1
  reachable "$p" "$h" || unique=1
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
# 用法：archive_worktree <路径> <是否需要保全历史:0|1>
#   1 = 该树有独有的提交，必须额外生成 Git bundle 并用 `git bundle verify` 校验；
#       仅靠 diff 补丁 + 文件压缩包无法保全提交历史。
# ---------------------------------------------------------------------------
archive_worktree() {
  local p="$1" need_history="${2:-0}"
  local name head branch before_status untracked_list staging final

  name="$(basename "$p")"
  head="$(git -C "$p" rev-parse HEAD 2>/dev/null)" || {
    echo "归档失败：读不到 HEAD（$p）" >&2; return 1; }
  branch="$(git -C "$p" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '(detached)')"
  before_status="$(git -C "$p" status --porcelain 2>/dev/null)" || {
    echo "归档失败：读不到工作树状态（$p）" >&2; return 1; }

  # 同名同日归档不得覆盖：目标名带 HEAD 短 SHA。
  final="$ARCHIVE_BASE/$name-$(printf '%s' "$head" | cut -c1-8)"
  if [ -e "$final" ]; then
    echo "归档失败：目标已存在，拒绝覆盖: $final" >&2
    return 1
  fi
  staging="$final.staging.$$"
  rm -rf "$staging" 2>/dev/null
  mkdir -p "$staging" || { echo "归档失败：无法创建暂存目录 $staging" >&2; return 1; }

  _archive_abort() {
    echo "归档失败：$1 —— 工作树已保留: $p" >&2
    rm -rf "$staging" 2>/dev/null
    return 1
  }

  # 1) 已跟踪文件的改动
  if ! git -C "$p" diff --binary HEAD > "$staging/changes.patch"; then
    _archive_abort "git diff 写入失败"
    return 1
  fi
  if [ -n "$before_status" ] && printf '%s\n' "$before_status" | grep -qv '^??' \
      && [ ! -s "$staging/changes.patch" ]; then
    _archive_abort "存在已跟踪改动但改动补丁为空"
    return 1
  fi

  # 2) 未跟踪文件：列表 → 打包 → 回读校验条目数
  untracked_list="$staging/untracked.list"
  if [ -n "$(git -C "$p" ls-files --others --exclude-standard 2>/dev/null | head -1)" ]; then
    if ! git -C "$p" ls-files -z --others --exclude-standard > "$untracked_list"; then
      _archive_abort "未跟踪文件列表写入失败"
      return 1
    fi
    local expected actual
    expected="$(tr -cd '\0' < "$untracked_list" | wc -c | tr -d ' ')"
    if ! tar -czf "$staging/untracked.tar.gz" -C "$p" --null -T "$untracked_list"; then
      _archive_abort "未跟踪文件打包失败"
      return 1
    fi
    if ! tar -tzf "$staging/untracked.tar.gz" > "$staging/untracked.toc" 2>/dev/null; then
      _archive_abort "未跟踪文件归档不可读"
      return 1
    fi
    actual="$(wc -l < "$staging/untracked.toc" | tr -d ' ')"
    if [ "$expected" != "$actual" ]; then
      _archive_abort "未跟踪文件归档条目数不符（期望 $expected，实际 $actual）"
      return 1
    fi
    rm -f "$untracked_list"
  fi

  # 3) 独有提交：Git bundle 保全对象，并当场 verify
  if [ "$need_history" = 1 ]; then
    if ! git -C "$p" bundle create "$staging/history.bundle" HEAD >/dev/null 2>&1; then
      _archive_abort "无法生成历史 bundle"
      return 1
    fi
    if ! git -C "$p" bundle verify "$staging/history.bundle" >/dev/null 2>&1; then
      _archive_abort "历史 bundle 校验失败"
      return 1
    fi
  fi

  # 4) 元数据
  {
    echo "path: $p"
    echo "branch: $branch"
    echo "head: $head"
    echo "archived: $(date +%F)"
    echo "status:"
    printf '%s\n' "$before_status"
  } > "$staging/meta.txt" || { _archive_abort "元数据写入失败"; return 1; }

  # 5) 归档期间工作树不得变化：变了说明还有别的进程在写，删除不安全
  if [ "$(git -C "$p" rev-parse HEAD 2>/dev/null)" != "$head" ]; then
    _archive_abort "归档期间 HEAD 变化"
    return 1
  fi
  if [ "$(git -C "$p" status --porcelain 2>/dev/null)" != "$before_status" ]; then
    _archive_abort "归档期间工作树内容变化"
    return 1
  fi

  # 6) 原子发布（同一文件系统内 mv 是原子的）
  if ! mv "$staging" "$final"; then
    _archive_abort "归档发布失败"
    return 1
  fi

  # 7) 发布后再校验一遍：落盘的才是真正要依赖的东西
  [ -s "$final/meta.txt" ] || { echo "归档失败：meta 缺失（$final）" >&2; return 1; }
  if [ -f "$final/untracked.tar.gz" ] \
      && ! tar -tzf "$final/untracked.tar.gz" >/dev/null 2>&1; then
    echo "归档失败：落盘压缩包损坏（$final）" >&2
    return 1
  fi
  if [ -f "$final/history.bundle" ] \
      && ! git -C "$p" bundle verify "$final/history.bundle" >/dev/null 2>&1; then
    echo "归档失败：落盘 bundle 校验失败（$final）" >&2
    return 1
  fi

  echo "  已归档到 $final（patch/meta$([ -f "$final/untracked.tar.gz" ] && echo '/未跟踪文件')$([ -f "$final/history.bundle" ] && echo '/history.bundle')）"
  return 0
}

# 删除前最后一道确认：重新分类，结果与预期不符就不删。
# 树在归档期间可能被别的 Agent 重新占用（新建分支、加未提交内容、开 PR）。
remove_worktree_if_still_expected() {
  local p="$1" h="$2" b="$3" expected="$4" rec
  rec="$(classify "$p" "$h" "$b")"
  if [ "$rec" != "$expected" ]; then
    echo "拒绝删除：$p 状态已从 $expected 变为 $rec" >&2
    return 1
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
    local rec; rec="$(classify "$p" "$h" "$b")"
    local age; age="$(age_days "$p")"
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
            # 独有提交必须由 bundle 保全并通过 verify，才允许删除。
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
