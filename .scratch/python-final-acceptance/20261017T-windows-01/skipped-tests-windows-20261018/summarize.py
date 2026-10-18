"""Map latest replay evidence onto the exact original 43 skipped node IDs."""
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parent
sys.path[:0] = [str(ROOT / "scripts"), str(ROOT / "algorithm")]
from acceptance_observe import observe
from acceptance_provider import Budget


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def main():
    inventory = read(OUT / "inventory.json")
    indexed = {row["nodeid"]: {**row, "attempts": []} for row in inventory}
    assert len(indexed) == 43
    for relative in ("nginx.xml", "mysql.xml", "nginx-recheck/nginx.xml", "recovery-recheck/recovery.xml"):
        path = OUT / relative
        for case in ET.parse(path).getroot().iter("testcase"):
            node = case.get("classname").replace(".", "/") + ".py::" + case.get("name")
            assert node in indexed, "Unregistered replay case"
            status = ("FAIL" if case.find("failure") is not None else
                      "ERROR" if case.find("error") is not None else
                      "SKIPPED" if case.find("skipped") is not None else "PASS")
            indexed[node]["attempts"].append({"status": status, "evidence": relative,
                "seconds": float(case.get("time", "0"))})
            indexed[node]["status"] = status
    counts = Counter(row.get("status", "NOT_RUN") for row in indexed.values())
    before = read(OUT / "business-before.json")
    after = observe(OUT.parent)
    assert before["sha256"] == after["sha256"]
    (OUT / "business-final.json").write_text(json.dumps(after, indent=2), encoding="utf-8")
    audits = [read(OUT / "nginx-process-audit.json"), read(OUT / "mysql-process-audit.json"),
              read(OUT / "recovery-recheck/process-audit.json")]
    cleanup = all(audit["status"] == "PASS" and not audit["survivingRecordedProcesses"] for audit in audits)
    assert cleanup and read(OUT / "nginx-recheck/result.json")["cleanup"] == "PASS"
    sources = read(OUT / "source-sha256.json")
    changed = [name for name, digest in sources.items()
               if hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != digest]
    assert changed == ["algorithm\\web\\tests\\test_cutover_proxy.py"] or changed == ["algorithm/web/tests/test_cutover_proxy.py"]
    formal = len(after["tables"]["t_saved_workflow_diagnosis"])
    assert formal == 0
    result = {"status": "PASS" if counts["PASS"] == 43 and cleanup else "FAIL",
        "timestampUtc": datetime.now(timezone.utc).isoformat(), "originalSkipped": 43,
        "passed": counts["PASS"], "failed": counts["FAIL"] + counts["ERROR"],
        "remainingSkipped": counts["SKIPPED"] + counts["NOT_RUN"],
        "scope": "Native Windows Nginx and real isolated MySQL/Redis; synthetic backends/models/decisions; not human acceptance",
        "firstAttempts": {"nginx": {"passed": 5, "failed": 2}, "mysql": {"passed": 25, "setupErrors": 11}},
        "changes": ["Correct stale session-route assertions using accepted ADR and business route",
                    "Shorten test temporary directory only; frozen archive unchanged"],
        "unchangedProductSources": True, "changedWebSource": changed,
        "businessTablesUnchanged": True, "formalRecords": formal, "cleanup": "PASS" if cleanup else "FAIL",
        "manualAcceptance": "DEFERRED", "overallAcceptance": "BLOCKED", "browserOption": "NOT_RUN",
        "budget": Budget(OUT.parent / "provider-calls.sqlite3").summary(), "newProviderRequests": 0,
        "baselineFullSuite": {"passed": 829, "skipped": 43, "evidence": "../windows-web-governance/web.xml"},
        "executionNote": "Baseline and replay are separate runs; this is not a fresh single full-suite run",
        "cases": list(indexed.values())}
    (OUT / "replay-summary.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = ["# Windows 原 43 项跳过测试补跑", "", f"结果：{result['status']}；{counts['PASS']}/43 通过，"
             f"{result['failed']} 失败，{result['remainingSkipped']} 仍跳过。", "",
        "保留原全量 829 通过/43 跳过，以及首轮 Nginx 5 通过/2 失败、MySQL 25 通过/11 准备错误；"
        "不将分次证据改写成一次全量执行。", "",
        "修正旧登录必须去 Java 的测试断言，并加强三个登录态接口去向检查；应用实现未变。"
        "冻结版本解压失败路径为 263 字符，改用工作树内短临时目录后最长为 190 字符，"
        "压缩包 SHA256 一致；未改系统长路径设置、冻结 SQL、历史或 11 项恢复测试的断言。", "",
        "使用已安装的原生 Windows Nginx、真实隔离 MySQL/Redis；后端标签、模型、资料和医生/保存决定均为合成夹具。"
        "没有运行 JVM、Linux、Docker/WSL，没有生产升级或切流。", "",
        "临时进程已停止，测试库和短目录保留用于审计。原参与者 8 张业务表摘要不变，"
        "正式记录仍为 0；人工验收继续搁置，整体验收仍 BLOCKED。浏览器可选检查未运行，"
        "不计为实际人工 UI 证据。无新增供应商请求，累计 LLM 20/50、embedding 43/500。", "",
        "## 逐项结果", "", "| 原测试 | 原跳过条件 | 最新结果 | 最新证据 |", "|---|---|---|---|"]
    for row in indexed.values():
        latest = row["attempts"][-1]
        lines.append(f"| `{row['nodeid']}` | {row['reason']} | {row['status']} | {latest['evidence']} |")
    (OUT / "README.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({key: result[key] for key in ("status", "originalSkipped", "passed", "failed", "remainingSkipped", "cleanup")}))


if __name__ == "__main__":
    main()
