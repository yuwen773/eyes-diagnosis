from pathlib import Path
import re
p = Path(r'C:/Users/yuwen/.codex/sessions/2026/10/15/rollout-2026-10-15T20-49-11-01a13f9b-d0ce-7783-9ef0-4c2c2e26a1e6.jsonl')
found = set()
for line in p.open(encoding='utf-8'):
    if 'redis-server.exe' in line:
        for path in re.findall(r'[A-Za-z]:[\\/][^\n"\x27]*?redis-server\.exe', line.replace('\\\\', '\\')):
            if Path(path).is_file():
                found.add(path)
print('\n'.join(sorted(found)))
