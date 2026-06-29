#!/usr/bin/env bash
# scripts/setup-github-facade.sh
# 一站式、幂等的 GitHub 仓库门面设置脚本
# 详见 docs/superpowers/specs/2026-06-29-github-facelift-design.md
set -euo pipefail

print_help() {
  cat <<'USAGE'
Usage: setup-github-facade.sh [选项]

设置 yuwen773/eyes-diagnosis 仓库的 GitHub 门面配置。

选项：
  --dry-run           只打印 gh 命令，不真正调用（默认 false）
  --skip-license      跳过 LICENSE 检查/创建（默认 false）
  --skip-github       跳过所有 GitHub API 调用（默认 false）
  --social-preview <path>
                      自定义 Social Preview 图路径（默认 docs/social-preview.png）
  --help              打印此帮助

退出码：
  0  全部成功
  1  前置检查失败
  2  GitHub API 调用失败
  3  最终校验失败

USAGE
}

main() {
  if [[ "${1:-}" == "--help" ]]; then
    print_help
    exit 0
  fi
  echo "ERROR: not yet implemented" >&2
  exit 1
}

main "$@"
