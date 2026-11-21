#!/usr/bin/env python3
"""核对 Surefire 报告：指定的用例**真的跑了**，且没有整类跳过。

为什么不能只看 `mvn test` 的退出码：
  - `-Dtest=SomeTest` 写错名字时，Surefire 默认「没匹配到就跳过」，退出码 0；
  - 类上标了 `@Disabled` / 前置条件不满足时整类 skipped，退出码照样 0；
  - 目标目录里留着上一轮的 XML，看起来「有报告」，其实是陈旧的。

三种情况都会被当成「测试通过」，而实际一行断言都没跑。这个脚本把它们变成失败。

用法：
  python scripts/check_surefire_result.py --classes 'SessionMessageQueueTest,Foo#bar' \
      --reports target/surefire-reports --since 1732000000

退出码：0 通过；1 失败（用例失败/没跑/整类跳过）；2 用法或报告目录问题。
"""

from __future__ import annotations

import argparse
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


class Report:
    def __init__(self, path: Path, fqcn: str) -> None:
        self.path = path
        self.fqcn = fqcn
        self.tests = 0
        self.skipped = 0
        self.failures = 0
        self.errors = 0
        self.cases: list[tuple[str, str]] = []  # (name, ok|fail|skip)

    @property
    def simple_name(self) -> str:
        return self.fqcn.rsplit(".", 1)[-1]

    @property
    def ran(self) -> int:
        return self.tests - self.skipped


def load(path: Path) -> Report:
    fqcn = path.name[len("TEST-"):-len(".xml")] if path.name.startswith("TEST-") else path.stem
    report = Report(path, fqcn)
    root = ET.parse(path).getroot()
    # <testsuite tests="8" skipped="0" failures="0" errors="0">
    report.tests = int(root.get("tests", "0"))
    report.skipped = int(root.get("skipped", "0"))
    report.failures = int(root.get("failures", "0"))
    report.errors = int(root.get("errors", "0"))
    for case in root.iter("testcase"):
        name = case.get("name", "?")
        state = "ok"
        for child in case:
            tag = child.tag
            if tag in ("failure", "error"):
                state = "fail"
                break
            if tag == "skipped":
                state = "skip"
        report.cases.append((name, state))
    return report


def parse_patterns(raw: str) -> list[tuple[str, str | None]]:
    patterns: list[tuple[str, str | None]] = []
    for item in raw.split(","):
        item = item.strip()
        if not item:
            continue
        if "#" in item:
            cls, method = item.split("#", 1)
            patterns.append((cls.strip(), method.strip() or None))
        else:
            patterns.append((item, None))
    return patterns


def matches(pattern_class: str, report: Report) -> bool:
    """允许写简单类名或全限定名；简单名要求精确匹配，避免 Foo 命中 FooBar。"""
    if pattern_class == report.fqcn:
        return True
    return pattern_class == report.simple_name


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--classes", default="", help="逗号分隔；支持 Class 与 Class#method")
    parser.add_argument("--reports", default="target/surefire-reports")
    parser.add_argument("--since", type=float, default=None,
                        help="只认 mtime >= 该 epoch 秒的报告（防陈旧报告冒充本轮结果）")
    parser.add_argument("--log", default=None, help="Maven 日志路径，仅用于错误提示")
    args = parser.parse_args()

    reports_dir = Path(args.reports)
    if not reports_dir.is_dir():
        print(f"FAIL(surefire): 报告目录不存在：{reports_dir}"
              + (f"（日志：{args.log}）" if args.log else ""))
        return 2

    xml_files = sorted(reports_dir.glob("TEST-*.xml"))
    fresh: list[Report] = []
    stale = 0
    for path in xml_files:
        if args.since is not None and path.stat().st_mtime < args.since:
            stale += 1
            continue
        try:
            fresh.append(load(path))
        except ET.ParseError as broken:
            print(f"FAIL(surefire): 报告无法解析：{path.name} ({broken})")
            return 1

    if args.since is not None and not fresh:
        print(f"FAIL(surefire): 本轮没有产生任何报告"
              f"（{len(xml_files)} 个 XML 全是上一轮留下的）。测试没有执行。")
        return 1

    patterns = parse_patterns(args.classes)
    selected: list[Report] = []
    missing: list[str] = []
    if patterns:
        target_dirs = {p.path.parent for p in fresh}
        for cls, method in patterns:
            hit = [r for r in fresh if matches(cls, r)]
            if not hit:
                missing.append(cls + ("#" + method if method else ""))
                continue
            for report in hit:
                if method is not None:
                    cases = [(n, s) for n, s in report.cases if n == method]
                    if not cases:
                        missing.append(f"{cls}#{method}（类跑了，但方法不在报告里）")
                        continue
                    for _, state in cases:
                        if state == "fail":
                            print(f"FAIL(surefire): {cls}#{method} 失败")
                            return 1
                        if state == "skip":
                            missing.append(f"{cls}#{method}（被跳过）")
                else:
                    selected.append(report)
        if missing:
            print("FAIL(surefire): 这些目标用例没有被真正执行：")
            for item in missing:
                print(f"  - {item}")
            if target_dirs:
                print(f"（本轮报告目录：{', '.join(str(d) for d in target_dirs)}；"
                      f"陈旧报告已忽略 {stale} 个）")
            if args.log:
                print(f"日志：{args.log}")
            return 1
    else:
        selected = fresh

    failures = sum(r.failures + r.errors for r in selected)
    if failures:
        print(f"FAIL(surefire): {failures} 个用例失败")
        for report in selected:
            for name, state in report.cases:
                if state == "fail":
                    print(f"  - {report.simple_name}#{name}")
        return 1

    fully_skipped = [r for r in selected if r.tests > 0 and r.ran == 0]
    if fully_skipped:
        print("FAIL(surefire): 整类被跳过（skip 不等于 pass）：")
        for report in fully_skipped:
            print(f"  - {report.simple_name}（tests={report.tests}, skipped={report.skipped}）")
        return 1

    empty = [r for r in selected if r.tests == 0]
    if empty and patterns:
        print("FAIL(surefire): 报告存在但没有任何用例：")
        for report in empty:
            print(f"  - {report.simple_name}")
        return 1

    total = sum(r.tests for r in selected)
    ran = sum(r.ran for r in selected)
    skipped = sum(r.skipped for r in selected)
    print(f"OK(surefire): {len(selected)} 个类，{ran} 个用例实际执行"
          + (f"，{skipped} 个跳过" if skipped else "")
          + (f"（共 {total}）" if total != ran else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
