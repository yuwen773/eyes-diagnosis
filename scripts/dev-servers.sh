#!/usr/bin/env bash
# 本地测试服务清单与回收。
#
#   scripts/dev-servers.sh list                 # 只读：列出常用开发端口上的监听进程
#   scripts/dev-servers.sh stop 5199 4173       # 停指定端口（连同子进程）
#   scripts/dev-servers.sh stop --all           # 停全部开发端口
#   scripts/dev-servers.sh stop --all --dry-run # 只看会杀谁
#
# 基础设施端口（MySQL 3306/3307、Redis 6379/6380、Chroma 8000）不会被 --all 触碰；
# 确实要停就显式写端口号。
set -uo pipefail

DEV_PORTS=(3000 4173 5173 5174 5180 5199 8081 18081 18085 8888)
INFRA_PORTS=(3306 3307 6379 6380 8000)

listeners() {
  # 输出 "<port> <pid>"
  netstat -ano -p tcp 2>/dev/null | tr -d '\r' \
    | awk '$4=="LISTENING"{n=split($2,a,":"); print a[n], $5}' | sort -n -u
}

cmdline_of() {
  powershell -NoProfile -Command \
    "Get-CimInstance Win32_Process -Filter 'ProcessId=$1' | Select-Object -ExpandProperty CommandLine" \
    2>/dev/null | tr -d '\r' | sed 's/  */ /g' | cut -c1-160
}

label_of() {
  local port="$1"
  for p in "${INFRA_PORTS[@]}"; do [ "$p" = "$port" ] && { echo "基础设施"; return; }; done
  for p in "${DEV_PORTS[@]}"; do [ "$p" = "$port" ] && { echo "开发"; return; }; done
  echo "其他"
}

cmd_list() {
  local all=0; [ "${1:-}" = "--all" ] && all=1
  printf '%-7s %-8s %-8s %s\n' "端口" "PID" "类别" "命令"
  listeners | while read -r port pid; do
    local lab; lab="$(label_of "$port")"
    [ "$all" = 0 ] && [ "$lab" = "其他" ] && continue
    printf '%-7s %-8s %-8s %s\n' "$port" "$pid" "$lab" "$(cmdline_of "$pid")"
  done
  [ "$all" = 0 ] && echo "（只列已知开发/基础设施端口；--all 看全部监听）"
}

kill_pid() {
  if [ -x /c/Windows/System32/taskkill.exe ]; then
    MSYS_NO_PATHCONV=1 /c/Windows/System32/taskkill.exe /PID "$1" /T /F >/dev/null 2>&1
  else
    kill "-$1" 2>/dev/null || kill -9 "$1" 2>/dev/null
  fi
}

cmd_stop() {
  local dry=0 all=0 ports=()
  for arg in "$@"; do
    case "$arg" in
      --all) all=1 ;;
      --dry-run) dry=1 ;;
      *[!0-9]*) echo "未知参数: $arg" >&2; exit 2 ;;
      *) ports+=("$arg") ;;
    esac
  done
  if [ "$all" = 1 ]; then ports+=("${DEV_PORTS[@]}"); fi
  if [ "${#ports[@]}" -eq 0 ]; then echo "用法: dev-servers.sh stop <端口...> | --all" >&2; exit 2; fi

  local found=0
  for port in $(printf '%s\n' "${ports[@]}" | sort -n -u); do
    while read -r p pid; do
      [ "$p" = "$port" ] || continue
      found=1
      echo "端口 $port → PID $pid ($(label_of "$port")): $(cmdline_of "$pid")"
      if [ "$dry" = 0 ]; then kill_pid "$pid"; sleep 1; fi
    done < <(listeners)
  done
  [ "$found" = 0 ] && echo "这些端口上没有监听进程。"
  if [ "$dry" = 0 ] && [ "$found" = 1 ]; then
    echo "--- 停后复查 ---"
    listeners | while read -r port pid; do
      for want in "${ports[@]}"; do
        [ "$want" = "$port" ] && echo "仍在监听: $port (PID $pid)"
      done
    done
    echo "完成。"
  fi
}

case "${1:-}" in
  list) cmd_list ;;
  stop) shift; cmd_stop "$@" ;;
  *) sed -n '2,12p' "$0"; exit 2 ;;
esac
