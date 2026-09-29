#!/usr/bin/env python3
"""Converte LCOV para o formato Generic Coverage do SonarQube.

Por que existe: o plugin sonar-apple lê cobertura de um bundle .xcresult do
xcodebuild. Projetos SwiftPM não produzem xcresult — `swift test` gera profdata
do llvm-cov. Sem esta ponte a cobertura não aparece, e um projeto com piso alto
de cobertura no CI apareceria como 0% no painel: o pior tipo de erro, o que
parece um fato apurado.

Generic Coverage é recurso do núcleo do SonarQube e vale para qualquer
linguagem cujos arquivos estejam indexados.

Uso:
    xcrun llvm-cov export -format=lcov BIN -instr-profile=PROF > cov.lcov
    lcov-to-sonar.py cov.lcov /caminho/do/repo > coverage.xml
"""
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


def parse_lcov(text):
    """Devolve {caminho: {linha: acertos}} a partir dos registros SF/DA."""
    files, current = {}, None
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("SF:"):
            current = line[3:]
            files.setdefault(current, {})
        elif line.startswith("DA:") and current is not None:
            number, _, hits = line[3:].partition(",")
            try:
                # Uma linha pode aparecer mais de uma vez (genéricos, inlining).
                # Somar preserva "foi coberta" em vez de deixar o último ganhar.
                files[current][int(number)] = files[current].get(int(number), 0) + int(hits or 0)
            except ValueError:
                continue
        elif line == "end_of_record":
            current = None
    return files


def main():
    if len(sys.argv) != 3:
        print("uso: lcov-to-sonar.py <arquivo.lcov> <raiz-do-repo>", file=sys.stderr)
        return 2

    lcov_path, base = Path(sys.argv[1]), Path(sys.argv[2]).resolve()
    files = parse_lcov(lcov_path.read_text(errors="replace"))

    root = ET.Element("coverage", version="1")
    written = 0
    for path, lines in sorted(files.items()):
        absolute = Path(path)
        if not absolute.is_absolute():
            absolute = (base / absolute).resolve()
        try:
            relative = absolute.relative_to(base)
        except ValueError:
            # Fora do repositório: dependência baixada, SDK do sistema. Um
            # caminho que não casa faz o SonarQube rejeitar o arquivo inteiro.
            continue
        element = ET.SubElement(root, "file", path=str(relative))
        for number, hits in sorted(lines.items()):
            ET.SubElement(element, "lineToCover",
                          lineNumber=str(number),
                          covered="true" if hits > 0 else "false")
        written += 1

    if written == 0:
        print(f"nenhum arquivo do LCOV caiu dentro de {base}", file=sys.stderr)
        return 1

    ET.ElementTree(root).write(sys.stdout, encoding="unicode", xml_declaration=True)
    print(f"{written} arquivos convertidos", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
