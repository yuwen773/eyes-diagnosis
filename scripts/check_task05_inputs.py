"""Check exact protected prerequisite contents without modifying other worktrees."""
import hashlib
import json
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parent.parent
inputs = root / 'docs/testing/realtime-collaboration-ui-20261111/inputs.json'
manifest = json.loads(inputs.read_text(encoding='utf-8'))
result = {}
for name, expected in manifest.items():
    tree = root.parent / name
    names = subprocess.check_output(['git', '-C', str(tree), 'ls-files', '-m', '-o', '--exclude-standard', '-z']).decode().split('\0')
    current = {n: hashlib.sha256((tree / n).read_bytes()).hexdigest() for n in set(names) if n and (tree / n).is_file()}
    if current != expected:
        raise SystemExit(f'Protected input changed: {name}')
    result[name] = {'files': len(expected), 'unchanged': True}
print(json.dumps(result, indent=2))
