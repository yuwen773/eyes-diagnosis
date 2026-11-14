#!/usr/bin/env python3
"""Score fixed synthetic output replays; never invokes a model or the product workflow.

The replay matrix is an instrument check, not an estimate of Agent effectiveness.
Current product reliability is imported separately from actual Surefire test cases.
"""
import argparse
from collections import Counter
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time
from xml.etree import ElementTree


CONDITIONS = {
    "single_agent": ["SINGLE"],
    "four_agent": ["VISION", "EVIDENCE", "EXPLANATION", "CRITIC"],
    "without_vision": ["EVIDENCE", "EXPLANATION", "CRITIC"],
    "without_evidence": ["VISION", "EXPLANATION", "CRITIC"],
    "without_explanation": ["VISION", "EVIDENCE", "CRITIC"],
    "without_critic": ["VISION", "EVIDENCE", "EXPLANATION"],
}
SUITES = {
    "com.csust.eyediagnosis.patientdraft.PatientDraftTest": 41,
    "com.csust.eyediagnosis.patientexplanation.PatientExplanationApiTest": 37,
}
RELIABILITY_CASES = {
    "insufficient_evidence": "absentEligibleEvidenceStopsAndDoesNotAskForExplanation",
    "tool_privilege": "providerToolRequestsCannotExecuteAnyTool",
    "crash_recovery": "processCrashKeepsSpentBudgetAndRecoveryRestrictsWithoutNewCall",
    "restricted_state": "restrictedCasesGiveOnlySafeActionableHints",
    "patient_ownership": "otherAccountsAndAnonymousCannotReadTasksOrCitations",
    "late_output": "timeoutDiscardsLateResultAndKeepsReservedCall",
    "withdrawal": "withdrawalDuringCriticPreventsReadyTransition",
}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def ratio(numerator, denominator):
    return {"numerator": numerator, "denominator": denominator,
            "value": numerator / denominator if denominator else None}


def replay(case, roles):
    """Test-only reference workflow. Agents consume shared response scripts, never gold.

    No product role bypasses are introduced. The real coordinator is assessed separately.
    """
    responses = case["responses"]
    trace = []
    started = time.perf_counter_ns()

    def call(role, context):
        tick = time.perf_counter_ns()
        if role == "VISION":
            output = {"additions": responses["visionAdditions"]}
        elif role == "EVIDENCE":
            output = {"sourceIds": responses["sourceIds"]}
        elif role in ("SINGLE", "EXPLANATION"):
            output = deepcopy(responses["corrected"] if context.get("rewrite") else responses["initial"])
            for claim in context.get("vision", {}).get("additions", []):
                if claim["factId"] not in {value["factId"] for value in output}:
                    output.append(deepcopy(claim))
        else:
            output = {"action": "REWRITE" if responses["corrected"] is not None and not context["rewritten"] else "NONE"}
        trace.append({"role": role, "context": deepcopy(context), "output": deepcopy(output),
                      "replay_ms": (time.perf_counter_ns() - tick) / 1_000_000})
        return output

    def finish(status, claims, reason):
        return {"status": status, "claims": claims, "stopReason": reason, "trace": trace,
                "offline_workflow_ms": (time.perf_counter_ns() - started) / 1_000_000}

    inference = case["input"]
    if inference["quality"] != "PASS" or inference["ood"]:
        return finish("RESTRICTED", [], "UNSAFE_INFERENCE")
    vision = call("VISION", {"inference": inference}) if "VISION" in roles else {"additions": []}
    if "SINGLE" in roles:
        # Same server-controlled source availability, no hidden Evidence role call.
        source_ids = responses["sourceIds"]
    elif "EVIDENCE" in roles:
        source_ids = call("EVIDENCE", {"inference": inference, "vision": vision})["sourceIds"]
    else:
        source_ids = []
    # Support annotations belong exclusively to the scorer, never to an agent context.
    sources = [{"id": source["id"], "excerpt": source["excerpt"]} for source in case["sources"]
               if source["eligible"] and source["id"] in source_ids]
    if not sources:
        return finish("RESTRICTED", [], "INSUFFICIENT_EVIDENCE")
    if "SINGLE" not in roles and "EXPLANATION" not in roles:
        return finish("RESTRICTED", [], "NO_EXPLANATION")
    context = {"inference": inference, "sources": sources, "vision": vision, "rewrite": False}
    role = "SINGLE" if "SINGLE" in roles else "EXPLANATION"
    draft = call(role, context)
    if "CRITIC" in roles:
        critique = call("CRITIC", {"inference": inference, "sources": sources, "draft": draft, "rewritten": False})
        if critique["action"] == "REWRITE":
            draft = call("EXPLANATION", {**context, "rewrite": True, "feedback": critique})
            call("CRITIC", {"inference": inference, "sources": sources, "draft": draft, "rewritten": True})
    # Identical traceability gate for baseline and all ablations. Semantic support is scored independently.
    by_id = {source["id"]: source for source in sources}
    for claim in draft:
        if not claim["references"] or any(reference["sourceId"] not in by_id or not reference["quote"].strip()
                or reference["quote"] not in by_id[reference["sourceId"]]["excerpt"] for reference in claim["references"]):
            return finish("RESTRICTED", draft, "INVALID_CITATION")
    return finish("REVIEW_READY", draft, None)


def score(case, observation):
    """Exact synthetic gold only: quote traceability alone is not semantic support."""
    sources = {source["id"]: source for source in case["sources"]}
    gold = {fact["id"]: fact["text"] for fact in case["facts"]}
    claims = observation["claims"]
    supported = set()
    counts = Counter(claims=len(claims), required=len(case["required"]), samples=1)
    failures = []
    for index, claim in enumerate(claims):
        known = gold.get(claim["factId"]) == claim["text"]
        claim_supported = False
        for reference in claim["references"]:
            counts["citations"] += 1
            source = sources.get(reference["sourceId"])
            traceable = bool(source and source["eligible"] and reference["quote"].strip()
                             and reference["quote"] in source["excerpt"])
            correct = traceable and known and reference["quote"] in source["supports"].get(claim["factId"], [])
            counts["traceable"] += int(traceable)
            counts["correct_citations"] += int(correct)
            claim_supported |= correct
            if not correct:
                failures.append({"kind": "incorrect_citation", "claim": index, "reference": reference})
        if claim_supported:
            supported.add(claim["factId"])
        else:
            counts["unsupported"] += 1
            failures.append({"kind": "unsupported_claim", "claim": index, "text": claim["text"]})
    omitted = sorted(set(case["required"]) - supported)
    counts["omitted"] = len(omitted)
    if omitted:
        failures.append({"kind": "omission", "facts": omitted})
    expected_ready = case["expectedStatus"] == "REVIEW_READY"
    ready = observation["status"] == "REVIEW_READY"
    counts["expected_ready"] = int(expected_ready)
    counts["ready_correct"] = int(expected_ready and ready)
    counts["expected_restricted"] = int(not expected_ready)
    counts["false_ready"] = int(not expected_ready and ready)
    counts["status_correct"] = int(case["expectedStatus"] == observation["status"])
    if not counts["status_correct"]:
        failures.append({"kind": "wrong_status", "expected": case["expectedStatus"], "actual": observation["status"]})
    return counts, failures


def metrics(counts):
    return {
        "samples": counts["samples"],
        "citation_correctness": ratio(counts["correct_citations"], counts["citations"]),
        "quote_traceability": ratio(counts["traceable"], counts["citations"]),
        "unsupported_claims": ratio(counts["unsupported"], counts["claims"]),
        "omissions": ratio(counts["omitted"], counts["required"]),
        "status_correctness": ratio(counts["status_correct"], counts["samples"]),
        "ready_recall": ratio(counts["ready_correct"], counts["expected_ready"]),
        "false_ready": ratio(counts["false_ready"], counts["expected_restricted"]),
    }


def reliability(folder):
    if folder is None:
        return {"status": "NOT_RUN", "reason": "No current Surefire reports supplied"}
    cases, files = [], []
    for suite, expected in SUITES.items():
        path = folder / f"TEST-{suite}.xml"
        root = ElementTree.parse(path).getroot()
        tests = root.findall("testcase")
        if len(tests) != expected or int(root.attrib["tests"]) != expected or root.attrib["name"] != suite:
            raise ValueError(f"Incomplete or mismatched reliability suite: {suite}; expected {expected}")
        files.append({"file": path.name, "sha256": digest(path)})
        for test in tests:
            outcome = "PASS"
            for tag in ("failure", "error", "skipped"):
                node = test.find(tag)
                if node is not None:
                    outcome = tag.upper()
                    break
            cases.append({"suite": suite, "name": test.attrib["name"], "status": outcome,
                          "elapsed_seconds": float(test.attrib.get("time", "0"))})
    groups = {}
    for group, method in RELIABILITY_CASES.items():
        selected = [case for case in cases if case["name"].split("(")[0] == method]
        if not selected:
            raise ValueError(f"Missing required reliability behavior: {method}")
        groups[group] = {"passed": sum(case["status"] == "PASS" for case in selected),
                         "denominator": len(selected), "cases": selected}
    return {"status": "PASS" if all(case["status"] == "PASS" for case in cases) else "FAIL",
            "passed": sum(case["status"] == "PASS" for case in cases), "denominator": len(cases),
            "groups": groups, "cases": cases, "files": files,
            "scope": "Actual Java coordinator and HTTP + isolated MySQL; synthetic model, identities and references. No real model service."}


def evaluate(corpus):
    if corpus["schemaVersion"] != 1 or corpus["kind"] != "SCRIPTED_REPLAY" or corpus["conditions"] != CONDITIONS:
        raise ValueError("Requires SCRIPTED_REPLAY and the fixed six-condition matrix")
    cases = corpus["cases"]
    if not cases or len({case["id"] for case in cases}) != len(cases):
        raise ValueError("Cases must have unique IDs and a nonempty denominator")
    for case in cases:
        if any(type(source["eligible"]) is not bool for source in case["sources"]):
            raise ValueError("Source eligible must be boolean")
        if len({fact["id"] for fact in case["facts"]}) != len(case["facts"]) or len({source["id"] for source in case["sources"]}) != len(case["sources"]):
            raise ValueError(f"Duplicate gold or source ID: {case['id']}")
        if len(set(case["required"])) != len(case["required"]) or not set(case["required"]) <= {fact["id"] for fact in case["facts"]}:
            raise ValueError(f"Invalid required facts: {case['id']}")
        if case["expectedStatus"] not in ("REVIEW_READY", "RESTRICTED"):
            raise ValueError("Unknown expected status")
    summaries, rows = {}, []
    for condition in CONDITIONS:
        totals = Counter()
        scoring_ns = 0
        workflow_ms = 0
        for case in cases:
            observation = replay(case, CONDITIONS[condition])
            workflow_ms += observation["offline_workflow_ms"]
            started = time.perf_counter_ns()
            counts, failures = score(case, observation)
            scoring_ns += time.perf_counter_ns() - started
            totals.update(counts)
            rows.append({"case": case["id"], "condition": condition, "observation": observation,
                         **metrics(counts), "failures": failures})
        summaries[condition] = {**metrics(totals),
                                "replay_scoring_ms": scoring_ns / 1_000_000, "offline_workflow_ms": workflow_ms,
                                "provider_calls": 0, "provider_cost_usd": 0,
                                "model_latency": "NOT_RUN", "model_tokens": "NOT_RUN", "model_cost": "NOT_RUN"}
    return summaries, rows


def fraction(metric):
    return f"{metric['numerator']}/{metric['denominator']}" if metric["denominator"] else "N/A (0/0)"


def markdown(report):
    lines = ["# #24 Agent collaboration evaluation", "", "Evidence: **SCRIPTED_REPLAY**.", "",
             "Hand-authored model-response scripts executed in a test-only reference workflow, not a model or the production coordinator. Differences are seeded fixture behavior; no empirical model or clinical effectiveness claim.",
             "All six conditions use the same inputs, response scripts and gold annotations. Each ablation removes one role from execution; shared safety gates remain enabled. Full contexts, outputs and executed role traces are retained. Production role permissions and gates are unchanged.",
             "Scoring covers internal candidate claims, not released patient results. Exact gold text/support annotations are synthetic arithmetic checks, not medical semantic adjudication.", "",
             f"Source commit: `{report['provenance']['source_commit']}`. Corpus SHA-256: `{report['provenance']['corpus_sha256']}`.", "",
             "| Condition | N | Correct citations | Traceable quotes | Unsupported claims | Omissions | Ready recall | False ready | Status correct | Offline workflow ms | Scoring ms | Provider USD |",
             "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]
    for condition, value in report["conditions"].items():
        fields = [fraction(value[key]) for key in ("citation_correctness", "quote_traceability", "unsupported_claims", "omissions", "ready_recall", "false_ready", "status_correctness")]
        lines.append(f"| {condition} | {value['samples']} | " + " | ".join(fields) + f" | {value['offline_workflow_ms']:.3f} | {value['replay_scoring_ms']:.3f} | 0 |")
    lines += ["", "Counts are micro-aggregated. Correct citation = eligible source + exact nonempty quote + exact gold text + annotated support. Unsupported = no such supporting reference. Omission = required gold fact without a supported claim; duplicates never improve coverage.",
              "A zero denominator is N/A. Ready recall exposes all-abstain variants. False ready uses only restricted samples. Timing separates local scripted workflow and scoring, including trace capture; provider cost is zero because no provider is called. Real model latency, tokens and cost: NOT_RUN.", "",
              "## Failure examples (all cells)", ""]
    for row in report["rows"]:
        if row["failures"]:
            lines.append(f"- `{row['condition']}/{row['case']}`: " + json.dumps(row["failures"], ensure_ascii=False))
    lines += ["", "## Current reliability evidence", ""]
    observed = report["evidence"]["java_mysql_http"]
    lines.append(f"Status: **{observed['status']}**. " + observed.get("scope", observed.get("reason", "")))
    if "groups" in observed:
        lines += [f"Total: {observed['passed']}/{observed['denominator']} actual test cases (not patients).", "",
                  "| Behavior | Passed / denominator |", "|---|---:|"]
        lines += [f"| {group} | {value['passed']}/{value['denominator']} |" for group, value in observed["groups"].items()]
        failures = [case for case in observed["cases"] if case["status"] != "PASS"]
        lines += ["", "Reliability failures/skips: " + (json.dumps(failures, ensure_ascii=False) if failures else "none in this supplied run.")]
    lines += ["", "## Evidence boundaries", "", "| Layer | Status |", "|---|---|"]
    lines += [f"| {layer} | {value['status']} |" for layer, value in report["evidence"].items()]
    lines += ["", "No conclusion of clinical validity or production acceptance. Full observations, case-level denominators, test names and artifact hashes are in results.json and corpus.json.", ""]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--surefire-dir", type=Path, help="Only reports from the current isolated run; historical reports must not be passed")
    args = parser.parse_args()
    try:
        corpus = json.loads(args.corpus.read_text(encoding="utf-8"))
        summaries, rows = evaluate(corpus)
        evidence = {layer: {"status": "NOT_RUN"} for layer in
                    ("real_model_service", "real_python_inference", "browser", "domain_review", "clinical", "production")}
        evidence["offline_scripted_replay"] = {"status": "RUN"}
        evidence["java_mysql_http"] = reliability(args.surefire_dir)
        commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=Path(__file__).resolve().parents[1], text=True).strip()
        report = {"kind": "SCRIPTED_REPLAY", "controls": corpus["controls"],
                  "provenance": {"source_commit": commit, "corpus_sha256": digest(args.corpus),
                                 "evaluator_sha256": digest(Path(__file__)), "created_at": datetime.now(timezone.utc).isoformat()},
                  "conditions": summaries, "rows": rows, "evidence": evidence}
        args.output.mkdir(parents=True, exist_ok=True)
        (args.output / "results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
        (args.output / "report.md").write_text(markdown(report), encoding="utf-8", newline="\n")
        print(f"SCRIPTED_REPLAY: {len(rows)} paired cells; reliability {evidence['java_mysql_http']['status']}; {args.output}")
        return int(evidence["java_mysql_http"]["status"] == "FAIL")
    except (OSError, ValueError, KeyError, TypeError, ElementTree.ParseError) as error:
        print(f"Evaluation rejected: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
