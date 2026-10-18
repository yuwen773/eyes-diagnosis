"""Locate a live pytest failure from ordered baseline JUnit and progress output."""
from pathlib import Path
import xml.etree.ElementTree as ET

run = Path(__file__).resolve().parent
cases = list(ET.parse(run / "windows-web/web.xml").getroot().iter("testcase"))
offset = 0
for line in (run / "windows-web-final.log").read_text(encoding="utf-8-sig").splitlines():
    progress = line.partition(" [")[0].strip()
    if progress and set(progress) <= set(".Fs"):
        if "F" in progress:
            # One new budget test precedes this point relative to the baseline.
            index = offset + progress.index("F") - 1
            for case in cases[max(0, index-1):index+2]:
                print(case.attrib)
        offset += len(progress)
