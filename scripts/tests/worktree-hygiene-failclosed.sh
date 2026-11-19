#!/usr/bin/env bash
# worktree-hygiene.sh 的 fail-closed 回归：归档任何一步失败，都不得删除工作树。
#
# 全部在临时仓库里跑，git / tar 用 PATH 替身注入故障；`git worktree remove`
# 被替身拦截并记日志——真实工作树一个都不会被删。
#
#   bash scripts/tests/worktree-hygiene-failclosed.sh
#
# 退出码 0 = 全部通过。
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../worktree-hygiene.sh"
REAL_GIT="$(command -v git)"
REAL_TAR="$(command -v tar)"
REAL_MV="$(command -v mv)"

ROOT="$(mktemp -d 2>/dev/null || mktemp -d -t hyster)"
BIN="$ROOT/bin"
mkdir -p "$BIN"
cleanup() { rm -rf "$ROOT" 2>/dev/null; }
trap cleanup EXIT

PASS=0
FAIL=0
ok()  { PASS=$((PASS + 1)); }
bad() { FAIL=$((FAIL + 1)); echo "  FAIL: $*" >&2; }

# ---------------------------------------------------------------------------
# 替身命令
# ---------------------------------------------------------------------------
cat > "$BIN/git" <<SHIM
#!/usr/bin/env bash
# 拦截 worktree remove（只记日志，不真删），并按 FAKE_* 注入 git 层故障。
case " \$* " in
  *" worktree remove "*)
    echo "\$*" >> "\${CALL_LOG:-/dev/null}"
    exit 0 ;;
esac
if [ "\${FAKE_FAIL_DIFF:-0}" = 1 ]; then
  case " \$* " in *" diff --binary "*) echo "shim: diff failed" >&2; exit 5 ;; esac
fi
if [ "\${FAKE_FAIL_BUNDLE_CREATE:-0}" = 1 ]; then
  case " \$* " in *" bundle create "*) exit 6 ;; esac
fi
if [ "\${FAKE_FAIL_BUNDLE_VERIFY:-0}" = 1 ]; then
  case " \$* " in *" bundle verify "*) exit 7 ;; esac
fi
case " \$* " in
  *" status --porcelain "*)
    [ "\${FAKE_FAIL_STATUS:-0}" != 1 ] || exit 77
    [ "\${FAKE_EMPTY_STATUS:-0}" != 1 ] || exit 0 ;;
  *" rev-parse HEAD "*) [ "\${FAKE_EMPTY_HEAD:-0}" != 1 ] || exit 0 ;;
  *" log -1 --format=%ct "*) [ "\${FAKE_EMPTY_AGE:-0}" != 1 ] || exit 0 ;;
  *" ls-files "*)
    [ "\${FAKE_FAIL_LIST:-0}" != 1 ] || exit 78
    [ "\${FAKE_EMPTY_LIST:-0}" != 1 ] || exit 0 ;;
  *" branch -r --contains "*) [ "\${FAKE_FAIL_REACHABILITY:-0}" != 1 ] || exit 79 ;;
  *" diff --binary HEAD "*)
    if [ "\${FAKE_MUTATE_TRACKED:-0}" = 1 ]; then
      "$REAL_GIT" "\$@" || exit \$?
      printf 'changed while already dirty\n' > "\$FAKE_MUTATE_PATH/a.txt"
      exit 0
    fi ;;
  *" bundle create "*)
    if [ "\${FAKE_TRUNCATE_BUNDLE:-0}" = 1 ]; then
      "$REAL_GIT" "\$@" || exit \$?
      for arg; do case "\$arg" in *.bundle) truncate -s -16 "\$arg";; esac; done
      exit 0
    fi ;;
esac
exec "$REAL_GIT" "\$@"
SHIM
chmod +x "$BIN/git"

cat > "$BIN/tar" <<SHIM
#!/usr/bin/env bash
# 只干扰打包（-czf）；解包校验（-tzf）走真 tar，这样「写坏的包」会真的读不出来。
case "\$1" in
  -tzf|*) ;;
esac
if [ "\$1" = "-czf" ]; then
  if [ "\${FAKE_TAR_FAIL:-0}" = 1 ]; then
    echo "shim: tar exploded" >&2
    exit 73
  fi
  if [ "\${FAKE_TAR_CORRUPT:-0}" = 1 ]; then
    : > "\$2"; echo "not-a-tarball" >> "\$2"
    exit 0
  fi
  if [ "\${FAKE_TAR_MUTATE:-0}" = 1 ] && [ -n "\${FAKE_TAR_MUTATE_PATH:-}" ]; then
    echo "concurrent edit" > "\$FAKE_TAR_MUTATE_PATH/raced-in.txt"
  fi
  if [ "\${FAKE_TAR_WRONG_BYTES:-0}" = 1 ]; then
    mkdir -p "\$FAKE_MUTATE_PATH/tar-source"
    printf 'wrong payload\n' > "\$FAKE_MUTATE_PATH/tar-source/u.txt"
    exec "$REAL_TAR" -czf "\$2" -C "\$FAKE_MUTATE_PATH/tar-source" u.txt
  fi
fi
exec "$REAL_TAR" "\$@"
SHIM
chmod +x "$BIN/tar"

cat > "$BIN/mv" <<SHIM
#!/usr/bin/env bash
"$REAL_MV" "\$@" || exit \$?
if [ "\${FAKE_AFTER_ARCHIVE_MUTATE:-0}" = 1 ]; then
  printf 'changed after archive publication\n' > "\$FAKE_MUTATE_PATH/a.txt"
fi
if [ "\${FAKE_AFTER_ARCHIVE_HEAD:-0}" = 1 ]; then
  "$REAL_GIT" -C "\$FAKE_MUTATE_PATH" commit --allow-empty -qm late-commit || exit \$?
fi
if [ "\${FAKE_AFTER_ARCHIVE_BRANCH:-0}" = 1 ]; then
  "$REAL_GIT" -C "\$FAKE_MUTATE_PATH" switch -qc late-branch || exit \$?
fi
SHIM
chmod +x "$BIN/mv"

# ---------------------------------------------------------------------------
# 夹具
# ---------------------------------------------------------------------------
CASE_REPO=""
CASE_WT=""
CASE_ARCHIVE=""
CALL_LOG=""

# setup_case <名字> [dirty|unique]
setup_case() {
  local name="$1" mode="${2:-dirty}"
  local c="$ROOT/$name"
  CASE_REPO="$c/repo"
  CASE_WT="$c/wt"
  CASE_ARCHIVE="$c/archive"
  CALL_LOG="$c/remove-calls.log"

  mkdir -p "$c"
  : > "$CALL_LOG"
  git init -q "$CASE_REPO" || return 1
  git -C "$CASE_REPO" config user.email tester@example.invalid
  git -C "$CASE_REPO" config user.name tester
  git -C "$CASE_REPO" config commit.gpgsign false
  echo base > "$CASE_REPO/a.txt"
  git -C "$CASE_REPO" add . && git -C "$CASE_REPO" commit -qm base || return 1

  # 有一个「远端已包含」的分支，dirty 树才会被判成 ARCHIVE 而不是 HOLD
  git init -q --bare "$c/remote.git"
  git -C "$CASE_REPO" remote add origin "$c/remote.git"
  git -C "$CASE_REPO" push -q origin HEAD:refs/heads/main || return 1
  git -C "$CASE_REPO" fetch -q origin || return 1

  git -C "$CASE_REPO" worktree add -q "$CASE_WT" -b "wt-$name" || return 1
  if [ "$mode" = unique ]; then
    # 独有提交：不在 origin/main 上
    git -C "$CASE_WT" config user.email tester@example.invalid
    git -C "$CASE_WT" config user.name tester
    git -C "$CASE_WT" config commit.gpgsign false
    echo unique > "$CASE_WT/unique.txt"
    git -C "$CASE_WT" add . && git -C "$CASE_WT" commit -qm "unique work" || return 1
  fi
  echo changed >> "$CASE_WT/a.txt"
  echo untracked > "$CASE_WT/u.txt"
  return 0
}

# run_reap <reap 参数…>；故障开关由调用方以环境变量传入
run_reap() {
  (
    cd "$CASE_REPO" || exit 90
    PATH="$BIN:$PATH" \
    IRIS_NO_PR_LOOKUP=1 IRIS_ARCHIVE_BASE="$CASE_ARCHIVE" \
    CALL_LOG="$CALL_LOG" REAL_GIT="$REAL_GIT" REAL_TAR="$REAL_TAR" FAKE_MUTATE_PATH="$CASE_WT" \
    bash "$SCRIPT" reap --older-than 0 --apply "$@"
  ) > "$ROOT/last-run.log" 2>&1
  echo $?
}

remove_calls() {
  [ -f "$CALL_LOG" ] || { echo 0; return; }
  wc -l < "$CALL_LOG" | tr -d ' '
}

wt_alive() { [ -d "$CASE_WT" ]; }

# 失败反例的统一断言：删除 0 次、工作树还在、归档未被「宣告成功」
assert_blocked() {
  local label="$1" rc="$2"
  local n; n="$(remove_calls)"
  [ "$n" = 0 ] && ok || bad "$label: 删除命令被调用 $n 次（必须为 0）"
  wt_alive && ok || bad "$label: 工作树已被删除"
  [ "$rc" != 0 ] || bad "$label: 脚本整体返回 0（应非零）"
  [ "$rc" != 0 ] && ok
}

# ---------------------------------------------------------------------------
# 用例
# ---------------------------------------------------------------------------
echo "== 1. tar 返回非零 =="
if setup_case c1 dirty; then
  rc="$(FAKE_TAR_FAIL=1 run_reap --archive-dirty)"
  assert_blocked "tar非零" "$rc"
else bad "c1 夹具创建失败"; fi

echo "== 2. git diff 写入失败 =="
if setup_case c2 dirty; then
  rc="$(FAKE_FAIL_DIFF=1 run_reap --archive-dirty)"
  assert_blocked "diff失败" "$rc"
else bad "c2 夹具创建失败"; fi

echo "== 3. 归档目录不可创建 =="
if setup_case c3 dirty; then
  touch "$ROOT/c3/blocker"
  CASE_ARCHIVE="$ROOT/c3/blocker/archive"   # 父路径是普通文件 → mkdir 必失败
  rc="$(run_reap --archive-dirty)"
  assert_blocked "目录不可写" "$rc"
else bad "c3 夹具创建失败"; fi

echo "== 4. 归档文件损坏 =="
if setup_case c4 dirty; then
  rc="$(FAKE_TAR_CORRUPT=1 run_reap --archive-dirty)"
  assert_blocked "包损坏" "$rc"
else bad "c4 夹具创建失败"; fi

echo "== 5a. 独有提交：bundle 生成失败 =="
if setup_case c5a unique; then
  rc="$(FAKE_FAIL_BUNDLE_CREATE=1 run_reap --archive-dirty --drop-unique)"
  assert_blocked "bundle生成失败" "$rc"
else bad "c5a 夹具创建失败"; fi

echo "== 5b. 独有提交：bundle 校验失败 =="
if setup_case c5b unique; then
  rc="$(FAKE_FAIL_BUNDLE_VERIFY=1 run_reap --archive-dirty --drop-unique)"
  assert_blocked "bundle校验失败" "$rc"
else bad "c5b 夹具创建失败"; fi

echo "== 6. 未跟踪文件打包失败 =="
if setup_case c6 dirty; then
  rc="$(FAKE_TAR_FAIL=1 run_reap --archive-dirty)"
  assert_blocked "未跟踪打包失败" "$rc"
else bad "c6 夹具创建失败"; fi

echo "== 7. 归档期间工作树发生变化 =="
if setup_case c7 dirty; then
  rc="$(FAKE_TAR_MUTATE=1 FAKE_TAR_MUTATE_PATH="$CASE_WT" run_reap --archive-dirty)"
  assert_blocked "归档期间改动" "$rc"
  [ -f "$CASE_WT/raced-in.txt" ] && ok || bad "c7: 并发改动没有被真的制造出来（夹具问题）"
else bad "c7 夹具创建失败"; fi

echo "== 8. 正常归档成功对照 =="
if setup_case c8 dirty; then
  rc="$(run_reap --archive-dirty)"
  n="$(remove_calls)"
  [ "$n" = 1 ] && ok || bad "c8: 成功归档后应删除 1 次，实际 $n"
  [ "$rc" = 0 ] || bad "c8: 脚本应返回 0，实际 $rc"
  arch="$(ls -d "$CASE_ARCHIVE"/* 2>/dev/null | head -1)"
  [ -n "$arch" ] && ok || bad "c8: 没有生成归档目录"
  [ -s "$arch/meta.txt" ] && ok || bad "c8: 归档缺少 meta.txt"
  [ -s "$arch/changes.patch" ] && ok || bad "c8: 归档缺少改动补丁"
  [ -f "$arch/untracked.tar.gz" ] && ok || bad "c8: 归档缺少未跟踪文件包"
  [ -f "$arch/history.bundle" ] && ok || bad "c8: 归档必须自包含，不依赖原仓库或远端"
else bad "c8 夹具创建失败"; fi

echo "== 9. 同名归档已存在：拒绝覆盖、拒绝删除 =="
if setup_case c9 dirty; then
  rc1="$(run_reap --archive-dirty)"; : > "$CALL_LOG"
  rc2="$(run_reap --archive-dirty)"   # 工作树仍在（替身没真删）→ 目标同名
  n="$(remove_calls)"
  [ "$n" = 0 ] && ok || bad "c9: 同名归档时仍调用了删除 $n 次"
  [ "$rc2" != 0 ] || bad "c9: 重复归档应返回非零"
  [ "$rc1" = 0 ] && ok || bad "c9: 第一次归档应成功"
else bad "c9 夹具创建失败"; fi

echo "== 10. 有独有提交的树：保留 history.bundle =="
if setup_case c10 unique; then
  rc="$(run_reap --archive-dirty --drop-unique)"
  n="$(remove_calls)"
  [ "$n" = 1 ] && ok || bad "c10: 成功归档后应删除 1 次，实际 $n"
  arch="$(ls -d "$CASE_ARCHIVE"/* 2>/dev/null | head -1)"
  [ -f "$arch/history.bundle" ] && ok || bad "c10: 独有提交必须留下 history.bundle"
  git -C "$CASE_REPO" bundle verify "$arch/history.bundle" >/dev/null 2>&1 \
    && ok || bad "c10: history.bundle 无法通过 git bundle verify"
else bad "c10 夹具创建失败"; fi

echo "== 11–23. 第二轮独立反例与相邻失败路径 =="
for fault in FAIL_STATUS EMPTY_STATUS EMPTY_HEAD EMPTY_AGE FAIL_LIST EMPTY_LIST FAIL_REACHABILITY TRUNCATE_BUNDLE MUTATE_TRACKED TAR_WRONG_BYTES AFTER_ARCHIVE_MUTATE AFTER_ARCHIVE_HEAD AFTER_ARCHIVE_BRANCH; do
  if setup_case "fault-$fault" unique; then
    rc="$(export "FAKE_$fault=1"; run_reap --archive-dirty --drop-unique)"
    assert_blocked "$fault" "$rc"
  else bad "$fault 夹具创建失败"; fi
done

echo "== 24. 独立空仓库恢复 HEAD、暂存/未暂存版本和未跟踪字节 =="
if setup_case c20 unique; then
  printf 'index version\n' > "$CASE_WT/a.txt"
  git -C "$CASE_WT" add a.txt
  printf 'working version\n' > "$CASE_WT/a.txt"
  printf '\0\1\377binary\n' > "$CASE_WT/u.txt"
  printf 'newline filename\n' > "$CASE_WT/"$'line\nbreak.txt'
  head="$(git -C "$CASE_WT" rev-parse HEAD)"
  rc="$(run_reap --archive-dirty --drop-unique)"
  [ "$rc" = 0 ] && ok || bad "c20: 归档失败 $rc"
  [ "$(remove_calls)" = 1 ] && ok || bad "c20: 成功对照未进入删除"
  arch="$(find "$CASE_ARCHIVE" -mindepth 1 -maxdepth 1 -type d -print -quit)"
  restore="$ROOT/c20/independent-restore"
  git init -q "$restore"
  git -C "$restore" config core.autocrlf false
  git -C "$restore" bundle unbundle "$arch/history.bundle" >/dev/null 2>&1 \
    && ok || bad "c20: 独立 bundle 恢复失败"
  git -C "$restore" checkout -q --detach "$head" \
    && ok || bad "c20: 独有 HEAD 无法恢复"
  git -C "$restore" apply --binary --index "$arch/index.patch" \
    && ok || bad "c20: 暂存补丁恢复失败"
  git -C "$restore" apply --binary "$arch/worktree.patch" \
    && ok || bad "c20: 工作区补丁恢复失败"
  tar -xzf "$arch/untracked.tar.gz" -C "$restore" \
    && ok || bad "c20: 未跟踪包恢复失败"
  cmp -s "$restore/a.txt" "$CASE_WT/a.txt" && ok || bad "c20: 工作区字节不符"
  cmp -s "$restore/u.txt" "$CASE_WT/u.txt" && ok || bad "c20: 未跟踪二进制字节不符"
  cmp -s "$restore/"$'line\nbreak.txt' "$CASE_WT/"$'line\nbreak.txt' \
    && ok || bad "c20: 换行文件名恢复失败"
  [ "$(git -C "$restore" show :a.txt)" = 'index version' ] \
    && ok || bad "c20: 暂存版本丢失"
  [ "$(git -C "$restore" rev-parse HEAD)" = "$head" ] \
    && ok || bad "c20: HEAD 不符"
else bad "c20 夹具创建失败"; fi

echo
echo "通过 $PASS，失败 $FAIL"
[ "$FAIL" = 0 ] || exit 1
