"""Assemble layered acceptance evidence; missing human/provider gates stay blocked."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET

from acceptance_provider import Budget

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def xml_counts(path):
    if not path.exists():
        return {"status": "BLOCKED", "reason": "Suite has not finished"}
    cases = list(ET.parse(path).getroot().iter("testcase"))
    failed = sum(case.find("failure") is not None or case.find("error") is not None for case in cases)
    skipped = sum(case.find("skipped") is not None for case in cases)
    return {"status": "FAIL" if failed else "PASS", "passed": len(cases) - failed - skipped,
            "failed": failed, "skipped": skipped, "evidence": str(path.relative_to(ROOT))}


def components_pass(path, names):
    if not path.exists():
        return False
    cases = [case for case in ET.parse(path).getroot().iter("testcase")
             if any(case.get("classname", "").endswith("." + name) for name in names)]
    return bool(cases) and all(case.find("failure") is None and case.find("error") is None for case in cases)


def assemble(run, attempt):
    attempts = [read(path) for path in sorted(run.glob("*/result.json")) if read(path).get("phase") != "summary"]
    extras = [read(path) for path in sorted(run.glob("*-extra-http.json"))]
    observations = sorted(run.glob("*-observation.json"))
    latest_observation = read(observations[-1]) if observations else {}
    services = [read(path) for path in sorted(run.glob("*/real-services.json"))]
    workflow_source = next((path for path in sorted(run.glob("*/inference-envelopes.json"), reverse=True)), None)
    model_rows = read(workflow_source) if workflow_source else []
    references = {"1_left.jpg": ["normal"], "0_left.jpg": ["cataract"], "2_left.jpg": ["diabetes", "other"],
                  "13_left.jpg": ["myopia"], "30_left.jpg": ["glaucoma", "other"]}
    manifest = read(run / "runtime/manifest.json") if (run / "runtime/manifest.json").exists() else {}
    names = {wid: name for name, wid in manifest.get("workflows", {}).items()}
    scenario_names = {scenario["workflowId"]: scenario["fileName"]
                      for scenario in manifest.get("saveScenarios", {}).values()}
    model_results: list[dict] = []
    additional_model_results: list[dict] = []
    for row in model_rows:
        name = names.get(row["workflowId"]) or scenario_names.get(row["workflowId"])
        if name is None:
            raise ValueError("Unregistered model workflow in acceptance evidence")
        prediction = json.loads(row["predictionSnapshot"])
        confidence = json.loads(row["confidenceSnapshot"])
        destination = model_results if row["workflowId"] in names else additional_model_results
        destination.append({"sample": name, "workflowId": row["workflowId"],
            "referenceLabels": references[name], "observedTop1": prediction["diseaseCode"],
            "uncalibratedSoftmaxPercent": confidence["probability"], "quality": row["qualityOutcome"],
            "referenceMismatch": prediction["diseaseCode"] not in references[name],
            "calibration": json.loads(row["calibrationSnapshot"])["status"],
            "envelopeId": row["inferenceEnvelopeId"], "weightSha256": row["modelWeightFingerprint"]})
    repaired_web = run / "windows-web-repaired/web.xml"
    if (run / "windows-web-myopia/web.xml").exists():
        repaired_web = run / "windows-web-myopia/web.xml"
    if (run / "windows-web-governance/web.xml").exists():
        repaired_web = run / "windows-web-governance/web.xml"
    web_path = repaired_web if repaired_web.exists() else run / "windows-web-final/web.xml"
    web_evidence = web_path.relative_to(run).as_posix()
    final_web = xml_counts(web_path)
    frontend_path = run / "plan-audit-20261018/frontend-result.json"
    if not frontend_path.exists():
        frontend_path = run / "myopia-excerpt-repair/frontend-result.json"
    if not frontend_path.exists():
        frontend_path = run / "noninteractive-repairs/frontend-result.json"
    if not frontend_path.exists():
        frontend_path = run / "frontend-result.json"
    frontend = read(frontend_path) if frontend_path.exists() else {}
    for key in ("buildLog", "testLog"):
        if key in frontend and (frontend_path.parent / frontend[key]).exists():
            frontend[key] = str((frontend_path.parent / frontend[key]).relative_to(run))
    reference_explanations = sorted(run.glob("*-reference-explanations-*/result.json"))
    reference_explanation = read(reference_explanations[-1]) if reference_explanations else {}
    concurrency_path = run / "controlled-worker-concurrency/results.json"
    concurrency = read(concurrency_path) if concurrency_path.exists() else {}
    concurrency_pass = concurrency.get("commands", {}).get("mysql-tests", {}).get("exitCode") == 0
    provider_checks = {}
    for result in attempts:
        if result.get("phase") == "providers":
            provider_checks.update(result.get("checks", {}))
    # The first registration failure was explicitly recovered after PID/path/time checks.
    recoveries = list(run.glob("*/cleanup-recovery.txt"))
    recovered_attempts = {path.parent.name for path in recoveries}
    # An attempt counts as clean when every registered child reports PASS, or when the
    # attempt carries an explicit recovery record for the children that did not.
    by_attempt: dict[str, list] = {}
    for path in run.rglob("processes.json"):
        by_attempt.setdefault(path.parent.name, []).extend(read(path))
    cleanup_pass = bool(by_attempt) and all(
        all(process.get("cleanup") == "PASS" for process in entries) or attempt in recovered_attempts
        for attempt, entries in by_attempt.items())
    live_manual = any(path.is_dir() and not (path / "result.json").exists() for path in run.glob("*-manual-*"))
    human = latest_observation.get("tables", {})
    reviews = human.get("t_human_review_task", [])
    confirmations = human.get("t_diagnosis_save_confirmation", [])
    formal = human.get("t_saved_workflow_diagnosis", [])
    participation_path = run / "manual-participation-deferred.json"
    if not participation_path.exists():
        participation_path = run / "manual-participation.json"
    participation = read(participation_path) if participation_path.exists() else {}
    reference_reads = sorted(run.glob("*-save-preparation-*/reference-governance-readback.json"))
    reference_rows = read(reference_reads[-1]) if reference_reads else []
    expected_references = {"2": "normal", "4": "cataract", "8": "myopia"}
    approved_references = {str(row["id"]) for row in reference_rows
        if str(row["id"]) in expected_references and row.get("status") == 1
        and row.get("visibility") == "CURATED_PUBLIC" and row.get("reviewStatus") == "APPROVED"
        and expected_references[str(row["id"])] in row.get("diseaseCodes", [])
        and "DISEASE_OVERVIEW" in row.get("topicCodes", [])}
    references_pass = approved_references == set(expected_references)
    report = {"runId": run.name, "generatedUtc": datetime.now(timezone.utc).isoformat(), "status": "BLOCKED",
              "scope": "Windows pure Python migration and agreed real business chain",
              "budget": Budget(run / "provider-calls.sqlite3").summary(), "providers": provider_checks,
              "windowsWeb": final_web, "frontend": frontend, "realServiceAttempts": services,
              "previousWindowsWeb": xml_counts(run / "windows-web-final/web.xml"),
              "realReferenceExplanations": reference_explanation,
              "realReferenceExplanationEvidence": str(reference_explanations[-1].relative_to(run)) if reference_explanations else None,
              "controlledMySQLConcurrency": concurrency, "modelResults": model_results,
              "additionalModelResults": additional_model_results,
              "clinicalAccuracy": "OUT_OF_SCOPE", "modelCalibration": "NOT_CALIBRATED",
              "manualWindow": "RUNNING_OR_NOT_COMPLETED" if live_manual else "ENDED",
              "human": {"submittedReviews": sum(bool(r.get("decisionCode")) for r in reviews),
                        "saveConfirmations": len(confirmations), "formalRecords": len(formal),
                        "remainingParticipation": participation,
                        "status": "BLOCKED", "evidence": observations[-1].name if observations else None},
              "cleanup": {"status": "PASS" if cleanup_pass and not live_manual else "BLOCKED",
                          "processManifests": len(list(run.rglob("processes.json"))),
                          "explicitRegistrationRecovery": [str(p.relative_to(run)) for p in recoveries]},
              "exclusions": ["Linux", "Docker/WSL", "clinical effectiveness", "production cutover", "merge/push"]}
    extra_checks = {name: check for extra in extras for name, check in extra["checks"].items()}
    doc_pass = all(extra_checks.get(name, {}).get("status") == "PASS" for name in ("binaryDOC", "tableDOCX"))
    specs = (ROOT / "docs/superpowers/specs/2026-10-12-python-agent-migration-spec.md").read_text(encoding="utf-8")
    original = dict(re.findall(r"\| (AC-\d\d) \| ([^\n]+?) \|", specs))
    plan_audit_path = run / "plan-audit-20261018/completion.json"
    plan_audit = read(plan_audit_path) if plan_audit_path.exists() else {}
    automatic_ac = {row["id"]: row for row in plan_audit.get("acEvidence", [])}
    if plan_audit:
        report["planAudit"] = {key: plan_audit[key] for key in
            ("status", "automaticItemsRemaining", "manualAcceptance", "controlledBrowserCases", "newLLMRequests", "newEvidence")}
        report["planAudit"]["evidence"] = str(plan_audit_path.relative_to(run))
    ac_rows = []
    proven = {
        "AC-05": (components_pass(web_path, ["test_inference", "test_workflow_inference", "test_worker_explanation_failure", "test_mcp_image"]), "controlled failure regressions; real strict weight loading", web_evidence),
        "AC-13": (concurrency_pass, "real isolated MySQL with controlled model/identity and fault branches", "controlled-worker-concurrency/results.json"),
        "AC-15": (final_web["status"] == "PASS", "controlled HTTP contract regressions plus real login/ID/upload seams", web_evidence),
        "AC-16": (doc_pass and components_pass(web_path, ["test_document_upload", "test_knowledge"]), "real COS/embedding/Chroma DOC and DOCX; controlled invalid/empty files", "*-extra-http.json; " + web_evidence),
        "AC-17": (concurrency_pass, "real MySQL lease/fencing/version/transaction regression, controlled model", "controlled-worker-concurrency/results.json"),
        "AC-19": (any(s.get("gates", {}).get("realInfrastructure", {}).get("status") == "PASS" for s in services),
                  "Python Cookie/Redis replacement; old Java results remain historical", "*/real-services.json"),
    }
    for number in range(1, 23):
        ac = f"AC-{number:02}"
        boundary = "Original business requirement; rare/abnormal branches use separately labelled controlled regression"
        if ac in {"AC-18", "AC-19", "AC-20"}:
            boundary = "ADR 0001 and 2026-10-17 plan supersede JVM requirements; Windows direct API/CORS scope, no production release"
        passed, kind, source = proven.get(ac, (False, "real partial HTTP/model evidence + controlled regression; human closure pending",
                                              "*/real-services.json; *-observation.json; " + web_evidence))
        limitation = ("Result limited to the listed evidence layer; no clinical or production claim" if passed else
                      "Real structured explanation, actual human decisions, or full scenario closure remains unproven")
        automatic = automatic_ac.get(ac)
        if automatic:
            passed = automatic["criterionStatus"] == "PASS"
            kind = "Layered technical evidence; actual-participant actions remain separately required in AC-08/09/11/21"
            source += "; " + str(plan_audit_path.relative_to(run))
            limitation = automatic["remainingDependency"]
        ac_rows.append({"id": ac, "original": original.get(ac, "MISSING_SPEC_REQUIREMENT"), "currentBoundary": boundary,
                        "evidenceType": kind, "status": "PASS" if passed else "BLOCKED", "source": source, "limitation": limitation,
                        "automatedStatus": automatic["automatedStatus"] if automatic else "NOT_SEPARATELY_AUDITED",
                        "automatedModules": automatic["automatedModules"] if automatic else []})
    report["acceptanceCriteria"] = ac_rows
    report["referenceGovernance"] = {"status": "PASS" if references_pass else "BLOCKED",
        "evidence": str(reference_reads[-1].relative_to(run)) if reference_reads else None,
        "approvedDocumentIds": sorted(approved_references),
        "scope": "Participant-confirmed review recorded through admin API; not human admin UI evidence"}
    visibility_path = run / "governance-visibility-repair/real-mysql-result.json"
    visibility = read(visibility_path) if visibility_path.exists() else {}
    visibility_regression = xml_counts(run / "governance-visibility-repair/focused.xml")
    visibility_pass = (visibility.get("status") == "PASS" and visibility.get("cleanup") == "PASS"
        and visibility_regression["status"] == "PASS"
        and visibility.get("sourceSha256") == hashlib.sha256(
            (ROOT / "algorithm/web/routers/knowledge.py").read_bytes()).hexdigest())
    report["governanceVisibility"] = {"status": "PASS" if visibility_pass else "BLOCKED",
        "regression": visibility_regression,
        "evidence": str(visibility_path.relative_to(run)) if visibility_path.exists() else None,
        "scope": "Immediate read and restart durability with synthetic governance fixtures; not human acceptance"}
    report["blockers"] = ["Actual patient and doctor UI actions and separate approve/refuse-save evidence are not complete",
                          "Image deidentification confirmation pending for external supplementary sample upload"]
    if provider_checks.get("structuredExplanation", {}).get("status") != "PASS":
        report["blockers"].append("Production structured explanation has not passed its latest real-provider check")
    withheld = [check["disease"] for check in reference_explanation.get("checks", []) if check["status"] != "PASS"]
    if withheld:
        report["blockers"].append("Real reference explanation remains correctly withheld by claim policy: " + ", ".join(withheld))
    if not references_pass:
        report["blockers"].append("Reference governance is pending actual review; no automatic APPROVED flag")
    if not visibility_pass:
        report["blockers"].append("Governance success-response visibility and durability remain unverified")
    if participation.get("status") == "NOT_EXECUTED":
        report["blockers"].append("Remaining human acceptance not executed: participant declined further manual actions")
    elif participation.get("status") == "DEFERRED":
        report["blockers"].append("Remaining human acceptance deferred at participant request")
    if final_web["status"] != "PASS":
        report["blockers"].append("Final Windows Web regression has not passed")
    if report["cleanup"]["status"] != "PASS":
        report["blockers"].append("Owned runtime cleanup is not complete")
    if plan_audit and (plan_audit["status"] != "PASS" or plan_audit["automaticItemsRemaining"]):
        report["blockers"].append("Plan re-audit has remaining automatic checks; see its detailed evidence")
    replay_path = run / "skipped-tests-windows-20261018/replay-summary.json"
    if replay_path.exists():
        replay = read(replay_path)
        report["windowsSkippedReplay"] = {key: replay[key] for key in
            ("status", "originalSkipped", "passed", "failed", "remainingSkipped", "scope")}
        report["windowsSkippedReplay"]["evidence"] = str(replay_path.relative_to(run))
        if replay["status"] != "PASS":
            report["blockers"].append("Windows skipped-test replay has unresolved checks; see per-case evidence")
    (attempt / "summary.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = [f"# Windows 最终 Python 验收：{run.name}", "", "**当前结论：BLOCKED；第 21 票不关闭。**", "",
             "所有本轮运行证据按 attempt 保留；历史失败和训练目录样本不匹配结果保留。", "",
             f"调用累计：LLM {report['budget']['llm']['used']}/50；embedding {report['budget']['embedding']['used']}/500 个输入文本。", "",
             f"最终 Windows Web：{json.dumps(final_web, ensure_ascii=False)}。", "",
             f"前端 build exit={frontend.get('buildExit')}，test exit={frontend.get('testExit')}；详细输出见前端日志。", "",
             "## 当前阻塞", ""] + ["- " + item for item in report["blockers"]]
    lines += ["", "## 分层证据", "", "| 层级 | 结果/来源 |", "|---|---|"]
    for key, value in provider_checks.items():
        lines.append(f"| 真实供应商 {key} | {value['status']}；供应商响应不改写，失败计入额度 |")
    if "windowsSkippedReplay" in report:
        replay = report["windowsSkippedReplay"]
        lines.append(f"| Windows 原跳过项补跑 | {replay['status']}；{replay['passed']}/{replay['originalSkipped']} 通过，"
                     f"{replay['remainingSkipped']} 仍跳过；{replay['evidence']}；与上述全量分次执行 |")
    if plan_audit:
        lines.append(f"| 计划自动子项再核对 | {plan_audit['status']}；4 类合成等待浏览器刷新、COS 图片加载、真实普通聊天、"
                     "执行中重启、原页面只读刷新及新前端验证；plan-audit-20261018/README.md；人工仍搁置 |")
    lines += ["| 真实基础设施/模型 | 见各 attempt/real-services.json；原入口、隔离 MySQL/Redis/Chroma、真实权重 |",
              f"| 审批响应可见性 | {report['governanceVisibility']['status']}；{report['governanceVisibility']['evidence']}；合成资料与原 API，不是人工验收 |",
              "| 受控并发 | controlled-worker-concurrency/results.json；不能冒充真实参与者 |",
              "| 人工 UI | 见 observation 与截图；只有实际参与者的决定才计入 |",
              "| 资源保全 | runtime 保留数据库/向量/账号；objects.json 与 extra-http 文件仅列本轮对象 |", "",
              "## 原五图", "", "得分为未校准 softmax，不是患病概率；样本来自训练目录，不计算临床准确率。", "",
              "| 样本 | 参考标签集合 | top-1 | 得分 | 质量 | 标签不符 |", "|---|---|---|---|---|---|"]
    for row in model_results:
        lines.append(f"| {row['sample']} | {' + '.join(row['referenceLabels'])} | {row['observedTop1']} | "
                     f"{row['uncalibratedSoftmaxPercent']:.4f} | {row['quality']} | {row['referenceMismatch']} |")
    lines += ["", "## AC-01～AC-22", "", "自动子项完成不等于完整实际参与者链路验收；整体结果和未完成依赖分别保留。", "",
              "| AC | 原要求 | 当前边界 | 证据层 | 整体结果 | 自动子项 | 来源与限制 |", "|---|---|---|---|---|---|---|"]
    for row in ac_rows:
        lines.append("| " + " | ".join(str(row[key]).replace("|", "/") for key in
                     ("id", "original", "currentBoundary", "evidenceType", "status", "automatedStatus")) +
                     " | " + row["source"] + "；" + row["limitation"] + " |")
    lines += ["", "## 恢复", "", "保留相同 runId；先检查 8080/5173 端口。仅从主检出 .env 读取供应商凭据，另在进程环境提供本机无库名 MySQL admin URL。", "",
              "```powershell", "algorithm/.venv-model-acceptance/Scripts/python.exe scripts/accept_python_migration.py --run-id " + run.name +
              " --phase manual --manual-seconds 1200", "```", "",
              "先核对最新供应商与解释证据，不自动重复已完成调用；不自动批准复核/资料审核/保存，不清空数据或调用计数。", "",
              "Linux、临床效果、生产发布、合并和推送不属于本轮通过声明。"]
    (attempt / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (run / "README.md").write_text(f"# {run.name}\n\n当前摘要：[report.md]({attempt.name}/report.md)。\n\n"
                                  "历史 attempt 与失败证据全部保留；此文件仅为最新摘要索引。\n", encoding="utf-8")
    return {"status": "BLOCKED", "summary": str((attempt / "report.md").relative_to(ROOT)),
            "blockers": report["blockers"], "budget": report["budget"]}
