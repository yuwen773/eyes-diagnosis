"""Scan active delivery files for retired builds, commands and source reads.

Historical docs/evidence and private build/runtime directories are outside this
static gate. Runtime and clean-image verification remain separate checks.
"""
import argparse
import ast
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
DIRECTORIES = ("algorithm/web", "algorithm/eye_diagnosis", "algorithm/mcp_server",
               "scripts", ".github/workflows", "deploy/python", "frontend/openapi")
FILES = ("pyproject.toml", "MANIFEST.in", "algorithm/generate_proto.py",
         "algorithm/requirements-web.lock", "algorithm/requirements-web.txt",
         "README.md", "AGENTS.md", "docs/python-delivery.md", "frontend/package.json")
PATTERNS = (
    r"actions/setup-java@",
    r"(?im)^\s*(?:&\s*)?(?:java(?:\.exe)?|mvn(?:\.cmd)?|flyway)\s",
    r"(?im)^\s*(?:tika|jpype1|pyjnius)\s*[=<>]",
    r"(?:^|\s)(?:Path|open)\(\s*['\"]src/(?:main|test)/",
    r"(?:subprocess\.(?:run|Popen|check_output)|run)\(\s*\[\s*['\"](?:java|mvn|flyway)['\"]",
    r"(?:TIKA_APP_JAR|TIKA_SERVER_JAR|JAVA_BASE_URL)",
    r"(?:^|\s)(?:openjdk[\w-]*|default-jre[\w-]*|default-jdk[\w-]*|maven)(?:\s|$)",
    r"(?:eclipse-temurin|amazoncorretto|openjdk):",
    r"(?i)\bRUN\s+(?:java|mvn|flyway)\s",
)


def python_dependencies(content: str) -> list[int]:
    lines = []
    for node in ast.walk(ast.parse(content)):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            modules = [node.module or ""] if isinstance(node, ast.ImportFrom) else [a.name for a in node.names]
            if any(module.split(".")[0] in {"tika", "jpype", "jnius"} for module in modules):
                lines.append(node.lineno)
        if not isinstance(node, ast.Call) or not node.args:
            continue
        argument = node.args[0]
        if isinstance(argument, (ast.List, ast.Tuple)) and argument.elts:
            first = argument.elts[0]
            if isinstance(first, ast.Constant) and first.value in {"java", "java.exe", "mvn", "mvn.cmd", "flyway"}:
                lines.append(node.lineno)
        function = node.func.id if isinstance(node.func, ast.Name) else ""
        if isinstance(node.func, ast.Attribute) and node.func.attr in {"getenv", "get"}:
            if isinstance(argument, ast.Constant) and argument.value in {"JAVA_BASE_URL", "TIKA_APP_JAR", "TIKA_SERVER_JAR"}:
                lines.append(node.lineno)
        if function in {"Path", "open"} and isinstance(argument, ast.Constant) and isinstance(argument.value, str):
            if argument.value.replace("\\", "/").startswith(("src/main/", "src/test/")):
                lines.append(node.lineno)
    return sorted(set(lines))


def scan(root: Path) -> list[dict[str, object]]:
    findings: list[dict[str, object]] = []
    retired = [root / "pom.xml", root / "deploy/workflow-migrations/pom.xml",
               root / "deploy/real-services/Issue19Probe.java"]
    retired += list((root / "src").rglob("*.java"))
    for file in retired:
        if file.is_file():
            findings.append({"path": file.relative_to(root).as_posix(), "reason": "retired-build-asset"})
    files = {root / name for name in FILES}
    for name in DIRECTORIES:
        files.update(file for file in (root / name).rglob("*")
                     if (file.suffix in {".py", ".ps1", ".sh", ".yml", ".yaml", ".toml", ".Dockerfile"}
                         or file.name == "Dockerfile")
                     and not {"__pycache__", "node_modules", ".venv"}.intersection(file.parts))
    for file in sorted(files):
        if not file.is_file():
            continue
        content = file.read_text(encoding="utf-8-sig")
        if file.name == "package.json":
            for name, command in json.loads(content).get("scripts", {}).items():
                if any(re.search(pattern, command) for pattern in PATTERNS):
                    findings.append({"path": file.relative_to(root).as_posix(), "script": name,
                                     "reason": "active-retired-dependency"})
            continue
        if file.suffix == ".py":
            findings.extend({"path": file.relative_to(root).as_posix(), "line": number,
                             "reason": "active-retired-dependency"}
                            for number in python_dependencies(content))
            continue
        fenced = False
        for number, line in enumerate(content.splitlines(), 1):
            if file.suffix == ".md":
                if line.lstrip().startswith("```"):
                    fenced = not fenced
                    continue
                if not fenced:
                    line = " ".join(re.findall(r"`([^`]+)`", line))
            if line.lstrip().startswith("#"):
                continue
            if any(re.search(pattern, line) for pattern in PATTERNS):
                findings.append({"path": file.relative_to(root).as_posix(), "line": number,
                                 "reason": "active-retired-dependency"})
    return findings


def main():
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args()
    findings = scan(args.root.resolve())
    print(json.dumps({"status": "FAIL" if findings else "PASS", "findings": findings}, indent=2))
    return int(bool(findings))


if __name__ == "__main__":
    raise SystemExit(main())
