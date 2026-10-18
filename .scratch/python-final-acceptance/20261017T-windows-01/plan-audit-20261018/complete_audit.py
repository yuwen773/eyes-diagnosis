"""Reconcile plan items and automatic AC evidence without replacing human gates."""
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parent
RUN = OUT.parent
sys.path[:0] = [str(ROOT / "scripts"), str(ROOT / "algorithm")]
from acceptance_observe import observe
from acceptance_provider import Budget


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def main():
    before = read(OUT / "business-before.json")
    after = observe(RUN)
    assert before["sha256"] == after["sha256"]
    assert not after["tables"]["t_saved_workflow_diagnosis"]
    (OUT / "business-final.json").write_text(json.dumps(after, indent=2), encoding="utf-8")
    chat = read(OUT / "real-chat-readonly-ui-03/result.json")
    patient = read(OUT / "readonly-ui-recheck/result.json")
    doctor = read(OUT / "doctor-readonly-refresh/result.json")
    inflight = read(OUT / "real-inflight-restart/result.json")
    assert chat["checks"]["realChatContextAcrossRestart"] == chat["checks"]["realChatSessionIsolation"] == "PASS"
    assert patient["checks"]["patientReadonlyRefresh"] == doctor["checks"]["doctorReadonlyRefresh"] == "PASS"
    assert inflight["status"] == "PASS" and read(OUT / "cos-browser.json")["status"] == "PASS"
    assert all(r["cleanup"] == "PASS" and r["businessTablesUnchanged"] for r in (chat, patient, doctor, inflight))
    browser_xml = OUT / "controlled-browser-waits/recovery.xml"
    browser_cases = list(ET.parse(browser_xml).getroot().iter("testcase"))
    assert len(browser_cases) == 4 and all(not any(c.find(tag) is not None for tag in ("error", "failure", "skipped")) for c in browser_cases)
    samples = [read(p) for p in (OUT / "controlled-browser-waits/cases").glob("*.json") if "-before-" not in p.name]
    assert len(samples) == 4 and all(r["browser"]["status"] == "PASS" for r in samples)
    assert all((OUT / "controlled-browser-waits/cases" / r["browser"]["screenshot"]).is_file() for r in samples)
    frontend = read(OUT / "frontend-result.json")
    assert frontend["buildExit"] == frontend["testExit"] == 0
    latest = {}
    for relative in ("windows-web-governance/web.xml", "skipped-tests-windows-20261018/nginx-recheck/nginx.xml",
                     "skipped-tests-windows-20261018/mysql.xml", "skipped-tests-windows-20261018/recovery-recheck/recovery.xml"):
        for case in ET.parse(RUN / relative).getroot().iter("testcase"):
            latest[(case.get("classname"), case.get("name"))] = case
    assert len(latest) == 872 and all(not any(c.find(tag) is not None for tag in ("error", "failure", "skipped")) for c in latest.values())
    modules = {
        1: ["test_chat_workflow", "test_workflow"], 2: ["test_session", "test_contracts", "test_tool_writes"],
        3: ["test_chat", "test_history_retrieval"], 4: ["test_workflow_inference", "test_quality_review"],
        5: ["test_inference", "test_worker_explanation_failure"], 6: ["test_controlled_evidence"],
        7: ["test_validated_explanation", "test_worker_explanation_failure"], 8: ["test_supplement"],
        9: ["test_save_confirmation"], 10: ["test_save_confirmation", "test_tool_writes"],
        11: ["test_quality_review", "test_final_clinical_review"],
        12: ["test_human_wait_restart", "test_handoff_recovery", "test_python_wait_recovery"],
        13: ["test_worker_concurrency"], 14: ["test_stream_reconnect", "test_chat_workflow"],
        15: ["test_contracts", "test_handoff_contracts"], 16: ["test_document_upload", "test_knowledge"],
        17: ["test_database_handoff", "test_worker_concurrency"], 18: ["test_controlled_evidence"],
        19: ["test_session", "test_cutover_proxy", "test_maintenance"],
        20: ["test_maintenance", "test_handoff_recovery"], 21: ["test_handoff_contracts"],
        22: ["test_workflow", "test_workflow_inference"]}
    ac_rows = []
    human_waits = {8: "实际参与者补充说明与继续", 9: "实际拒绝保存与批准保存两条独立任务", 11: "实际医生复核与自然触发的最终复核",
                   21: "实际患者/医生完整 UI 实操，包含重启后的原等待继续"}
    for number, names in modules.items():
        for name in names:
            assert any(c.get("classname", "").endswith("." + name) for c in latest.values()), name
        ac = f"AC-{number:02}"
        ac_rows.append({"id": ac, "automatedStatus": "PASS", "automatedModules": names,
            "criterionStatus": "BLOCKED" if number in human_waits else "PASS",
            "evidence": ["windows-web-governance/web.xml", "skipped-tests-windows-20261018/replay-summary.json"],
            "scope": "Controlled branch regressions plus the separately recorded real-service/model/browser evidence; not actual human decisions",
            "remainingDependency": human_waits.get(number, "本项技术检查已完成；实际操作者的完整链路由 AC-08/09/11/21 保留，不据此宣称临床或生产通过")})
    def item(identifier, status, scope, evidence, dependency=None):
        return {"id": identifier, "status": status, "automatedStatus": "PASS", "scope": scope,
                "evidence": evidence, "remainingDependency": dependency}
    plan = [
        item("2.1", "PASS", "COS SDK 接线修复与公开上传回归", ["cos-green.xml", "governance-visibility-repair/final-verification.json"]),
        item("2.2", "PASS", "原 API/Worker、独立服务、持久清单与身份核对清理", ["plan-audit-20261018/real-inflight-restart/result.json"]),
        item("2.3", "PASS", "真实供应商预检及浏览器读取已登记 COS 探针", ["20261017T120326Z-providers-25d849/result.json", "plan-audit-20261018/cos-browser.json"]),
        item("2.4", "BLOCKED", "权重、未校准状态与五图不匹配保留；三张补充样本已本机推理", ["20261017T101145-supplementary-offline.json"], "补充样本去标识及外发范围尚未确认"),
        item("3.1", "PASS", "当前源码快照、依赖/版本与既有证据差异已绑定；不称干净机器验收", ["plan-audit-20261018/source-sha256.json"]),
        item("3.2.1", "PASS", "真实 Python Cookie/Redis 登录隔离及原接口回归", ["skipped-tests-windows-20261018/replay-summary.json"]),
        item("3.2.2", "PASS", "真实 DOC/DOCX 的 COS/embedding/Chroma 与三份已审核参考资料检索解释；分层记录", ["20261017T100907-extra-http.json", "20261017T123739Z-reference-explanations-a68a9d/result.json"]),
        item("3.2.3", "BLOCKED", "真实原图进入生产图；自动部分到质量等待，既有两项合法受限终态保留", ["plan-audit-20261018/real-inflight-restart/result.json"], "质量/最终复核后的完整真实解释发布和保存需人工继续；禁止代批"),
        item("3.2.4", "PASS", "真实同键/聊天绑定与原推理来源；重复保存等用受控回归", ["plan-audit-20261018/real-inflight-restart/result.json", "windows-web-governance/web.xml"]),
        item("3.2.5", "PASS", "执行中真实模型恢复、真实现有等待恢复、四类合成等待恢复", ["plan-audit-20261018/real-inflight-restart/result.json", "plan-audit-20261018/controlled-browser-waits/recovery.xml"]),
        item("3.2.6", "PASS", "真实 SSE 断连/重连、真实患者与医生只读 F5、四类合成等待浏览器刷新", ["plan-audit-20261018/real-inflight-restart/reconnected.sse", "plan-audit-20261018/doctor-readonly-refresh/result.json"]),
        item("3.3", "BLOCKED", "实际参与者 UI 验收继续搁置，旧两份质量决定与 F5 确认保留", ["manual-participation-deferred.json"], "患者/医生操作、补充说明、自然最终复核、独立拒绝/批准保存及继续"),
        item("3.4", "PASS", "受控罕见分支及 Windows 原 43 项环境门禁；前端重新构建与 49 项", ["skipped-tests-windows-20261018/replay-summary.json", "plan-audit-20261018/frontend-result.json"]),
        item("4", "PASS", "预算共享累计、过程失败保留、数据保留与临时进程清理", ["plan-audit-20261018/completion.json"]),
        item("5", "BLOCKED", "计划/22 个 AC 自动子项已逐条归档；不提前关闭第 21 票", ["plan-audit-20261018/completion.json"], "正式验收依赖 3.3 和外发范围确认")]
    budget = Budget(RUN / "provider-calls.sqlite3").summary()
    assert budget["llm"]["used"] == 23 and budget["embedding"]["used"] == 43
    result = {"status": "PASS", "generatedUtc": datetime.now(timezone.utc).isoformat(), "automaticItemsRemaining": [],
        "overallAcceptance": "BLOCKED", "manualAcceptance": "DEFERRED", "formalRecords": 0,
        "businessTablesUnchanged": True, "controlledBrowserCases": 4, "frontendTests": 49,
        "newLLMRequests": 3, "budget": budget, "planItems": plan, "acEvidence": ac_rows,
        "newEvidence": {"cosBrowser": "cos-browser.json", "realChat": "real-chat-readonly-ui-03/result.json",
            "patientReadOnly": "readonly-ui-recheck/result.json", "doctorReadOnly": "doctor-readonly-refresh/result.json",
            "realInflightRestart": "real-inflight-restart/result.json", "controlledBrowser": "controlled-browser-waits/recovery.xml",
            "frontend": "frontend-result.json"},
        "limitations": ["Automatic subitems do not close actual human acceptance criteria",
            "No forced doctor approval, save authorization or original-task requeue",
            "No physical-once model-call claim; only committed-envelope uniqueness",
            "No Linux, production cutover, clean-machine, calibration or clinical-effectiveness acceptance"]}
    for entry in plan:
        assert all((RUN / path).is_file() or path.endswith("completion.json") for path in entry["evidence"]), entry["id"]
    (OUT / "completion.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = ["# 2026-10-18 验收计划再核对", "", "自动子项核对：PASS；当前未发现可独立继续执行的遗漏自动项。",
        "人工验收：DEFERRED；整体验收仍 BLOCKED，第 21 票不关闭。", "",
        "本次新增：四类合成等待的浏览器刷新、已登记 COS 图片的浏览器 img 加载、原 API 的三次真实普通聊天及跨重启/会话隔离、"
        "真实分类任务执行中 API/Worker 重启与 SSE 恢复、原患者/医生页面只读刷新，以及新前端 49 项/类型检查/构建。", "",
        "没有修改应用实现或安全规则。初次探针的字段名/终态名检查、隐藏 option 文本、医生内部任务 ID 定位错误均保留，"
        "只修正验收脚本；真实聊天组件在原 attempt 中已通过，后续只读 UI 复验没有重发模型请求。"
        "COS 顶层导航因 attachment 响应转为下载，应用使用的 img 元素加载已通过；没有改桶权限或响应头。", "",
        "原实际任务 8 张业务表摘要不变；原数据中的 2 条医生提交、0 条正式记录保留。两个新聊天会话仅含随机非医疗记号；"
        "执行中重启另用新隔离库和已授权的 1_left.jpg，本机推理、不外发图片。受控浏览器中的模拟决定不计为实际人工验收。", "",
        "累计 LLM 23/50、embedding 43/500；本次新增 LLM 3 次，失败也计数，不重置预算。", "",
        "## 逐条计划", "", "| 项目 | 自动子项 | 本项整体 | 剩余依赖 |", "|---|---|---|---|"]
    for row in plan:
        lines.append(f"| {row['id']} {row['scope']} | PASS | {row['status']} | {row['remainingDependency'] or '无'} |")
    lines += ["", "## AC 分层核对", "", "按已确认计划区分技术检查与真人实操：18 项在当前 Python/Windows 边界内有技术通过证据；"
              "AC-08/09/11/21 保留实际参与者阻塞。22 项均有自动子项记录，不将受控决定或自动浏览器计为真人验收。", "",
              "| AC | 自动子项 | 当前判据 | 受控 HTTP/Worker 回归来源 | 剩余依赖/限制 |", "|---|---|---|---|---|"]
    for row in ac_rows:
        lines.append(f"| {row['id']} | PASS | {row['criterionStatus']} | {', '.join(row['automatedModules'])} | {row['remainingDependency']} |")
    lines += ["", "当前仍需保留：实际参与者完整操作、依赖其继续的真实发布/保存闭环，以及补充样本去标识/外发范围确认。",
              "Linux、训练校准、临床效果、托管 CI、生产升级/切流、合并与推送不在本轮通过范围。"]
    (OUT / "README.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({"automaticAudit": "PASS", "automaticItemsRemaining": [], "overallAcceptance": "BLOCKED", "budget": budget}))


if __name__ == "__main__":
    main()
