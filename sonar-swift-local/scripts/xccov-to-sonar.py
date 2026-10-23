#!/usr/bin/env python3
"""Convert `xcrun xccov view --archive --json RESULT.xcresult` to Generic Coverage.

Canonical paths avoid the native plugin's /var vs ~/tmp mismatch.
Only executable lines inside the selected repository are included.
"""
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET


def convert(data, base):
    if not isinstance(data, dict): raise ValueError('xccov precisa produzir objeto por arquivo')
    base = Path(base).resolve(); files = {}
    for name, rows in data.items():
        if not isinstance(rows, list): raise ValueError('linhas xccov precisam ser lista')
        path = Path(name)
        if not path.is_absolute(): path = base/path
        try: relative = str(path.resolve().relative_to(base))
        except ValueError: continue
        for row in rows:
            if not isinstance(row, dict): raise ValueError('registro xccov inválido')
            number, executable = row.get('line'), row.get('isExecutable')
            if type(number) is not int or number <= 0 or type(executable) is not bool:
                raise ValueError('linha/isExecutable xccov inválidos')
            if not executable: continue
            count = row.get('executionCount')
            if type(count) is not int or count < 0: raise ValueError('contagem xccov inválida')
            lines = files.setdefault(relative, {})
            lines[number] = lines.get(number, 0) + count
    if not files: raise ValueError('nenhuma linha executável do xccov pertence ao repositório')
    root = ET.Element('coverage', version='1')
    for name, lines in sorted(files.items()):
        file = ET.SubElement(root, 'file', path=name)
        for number, count in sorted(lines.items()):
            ET.SubElement(file, 'lineToCover', lineNumber=str(number), covered='true' if count else 'false')
    return root


def main():
    if len(sys.argv) != 3:
        print('uso: xccov-to-sonar.py <xccov.json> <raiz-do-repo>', file=sys.stderr); return 2
    try: root = convert(json.loads(Path(sys.argv[1]).read_text()), Path(sys.argv[2]))
    except (OSError, ValueError) as error:
        print(f'Cobertura xccov inválida: {error}', file=sys.stderr); return 1
    ET.ElementTree(root).write(sys.stdout, encoding='unicode', xml_declaration=True)
    return 0


if __name__ == '__main__': sys.exit(main())
