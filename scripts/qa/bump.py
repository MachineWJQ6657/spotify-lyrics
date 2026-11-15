"""Bump the version everywhere and optionally add verifier checks.
usage: python bump.py <repo> <old> <new> [checks-file]
checks-file holds JS object lines to insert before `staticListeningIndicator:`."""
import json, sys
root, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
for name in ['package.json', 'package-lock.json']:
    p = f'{root}/{name}'
    data = json.load(open(p, encoding='utf-8'))
    data['version'] = new
    if name == 'package-lock.json':
        data['packages']['']['version'] = new
    open(p, 'w', encoding='utf-8', newline='\n').write(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
p = f'{root}/README.md'
s = open(p, encoding='utf-8').read()
a = f'当前源码与部署版本为 {old}'
assert a in s, 'README version line'
open(p, 'w', encoding='utf-8', newline='\n').write(s.replace(a, f'当前源码与部署版本为 {new}'))
if len(sys.argv) > 4:
    p = f'{root}/scripts/verify-package.cjs'
    s = open(p, encoding='utf-8').read()
    anchor = '  staticListeningIndicator:'
    assert s.count(anchor) == 1
    s = s.replace(anchor, open(sys.argv[4], encoding='utf-8').read().rstrip('\n') + '\n' + anchor)
    open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('bumped', old, '->', new)
