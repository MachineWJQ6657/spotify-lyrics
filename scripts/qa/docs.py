"""Prepend a TODO section and a CONTINUATION entry, and update the deployed line.
usage: python docs.py <repo> <old> <new> <oldChecks> <newChecks> <todo-file> <cont-file> <previous-cont-heading>"""
import re, sys
root, old, new, old_checks, new_checks, todo_file, cont_file, prev_heading = sys.argv[1:9]
p = f'{root}/TODO.md'
s = open(p, encoding='utf-8').read()
head = '# Syllable TODO\n\n'
assert s.startswith(head)
s = head + open(todo_file, encoding='utf-8').read().rstrip('\n') + '\n\n' + s[len(head):]
open(p, 'w', encoding='utf-8', newline='\n').write(s)

p = f'{root}/CONTINUATION.md'
s = open(p, encoding='utf-8').read()
m = re.search(r'- \*\*Deployed:\*\* ' + re.escape(old) + r' at `release/current/Syllable\.exe`; the desktop and Start Menu shortcuts point there with no arguments\. Rollback: `release/current-[0-9.]+-backup-\d+`\.', s)
assert m, 'deployed line'
import datetime
stamp = datetime.date.today().strftime('%Y%m%d')
s = s.replace(m.group(0), f'- **Deployed:** {new} at `release/current/Syllable.exe`; the desktop and Start Menu shortcuts point there with no arguments. Rollback: `release/current-{old}-backup-{stamp}`.', 1)
a = f'`node scripts/verify-package.cjs <dir>/win-unpacked` ({old_checks} checks).'
assert a in s, 'checks line'
s = s.replace(a, f'`node scripts/verify-package.cjs <dir>/win-unpacked` ({new_checks} checks).', 1)
assert s.count(prev_heading) == 1, 'previous heading'
s = s.replace(prev_heading, open(cont_file, encoding='utf-8').read().rstrip('\n') + '\n\n' + prev_heading, 1)
assert chr(0) not in s
open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('docs updated')
