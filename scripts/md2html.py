#!/usr/bin/env python3
"""markdown → один автономный HTML-файл (без внешних зависимостей в самом HTML).

Зачем: .md удобно читать в редакторе, но с телефона его не открыть и не
распечатать. Этот скрипт делает одну страницу со встроенными стилями, которую
можно открыть в браузере, распечатать в PDF или положить внутрь APK.

Использование:
    python3 scripts/md2html.py docs/REVERSE-APK.md docs/REVERSE-APK.html
    python3 scripts/md2html.py docs/REVERSE-APK.md web/docs/reverse-apk.html --back ../settings.html

Зависимость: pip install markdown
"""

import argparse
import re
import sys
from pathlib import Path

try:
    import markdown
except ImportError:  # pragma: no cover
    sys.stderr.write("нужен пакет markdown:  pip install markdown\n")
    raise SystemExit(2)


CSS = """
:root {
  --bg: #fbfcfe;
  --fg: #1b2432;
  --muted: #5f6f83;
  --line: #e2e8f0;
  --accent: #0f7b4f;
  --code-bg: #f3f6fa;
  --note: #fff8e6;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d1219;
    --fg: #e6eef8;
    --muted: #93a5ba;
    --line: #22303f;
    --accent: #4ade80;
    --code-bg: #141c26;
    --note: #2a2413;
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font: 16px/1.62 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
.topbar {
  position: sticky; top: 0; z-index: 2;
  display: flex; align-items: center; gap: 12px;
  padding: 10px 16px;
  background: color-mix(in srgb, var(--bg) 88%, transparent);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--line);
  font-size: 13px;
}
.topbar a { color: var(--accent); text-decoration: none; font-weight: 600; }
.topbar .name { color: var(--muted); margin-left: auto; font-size: 12px; }
main {
  max-width: 860px;
  margin: 0 auto;
  padding: 28px 20px 80px;
}
h1 { font-size: 28px; line-height: 1.25; margin: 0 0 8px; }
h2 {
  font-size: 21px; margin: 40px 0 12px; padding-top: 14px;
  border-top: 1px solid var(--line);
}
h3 { font-size: 17px; margin: 26px 0 8px; }
p { margin: 0 0 12px; }
a { color: var(--accent); }
strong { font-weight: 700; }
ul, ol { margin: 0 0 14px; padding-left: 22px; }
li { margin: 4px 0; }
li > ul, li > ol { margin: 6px 0 0; }
code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.9em;
  background: var(--code-bg);
  border: 1px solid var(--line);
  border-radius: 5px;
  padding: 1px 5px;
  word-break: break-word;
}
pre {
  background: var(--code-bg);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 14px 16px;
  overflow-x: auto;
  margin: 0 0 16px;
}
pre code { background: none; border: 0; padding: 0; font-size: 13px; line-height: 1.55; }
table {
  width: 100%;
  border-collapse: collapse;
  margin: 0 0 18px;
  font-size: 14px;
}
th, td {
  text-align: left;
  padding: 8px 10px;
  border: 1px solid var(--line);
  vertical-align: top;
}
th { background: var(--code-bg); font-weight: 700; }
tbody tr:nth-child(even) { background: color-mix(in srgb, var(--code-bg) 55%, transparent); }
blockquote {
  margin: 0 0 16px;
  padding: 10px 14px;
  border-left: 3px solid var(--accent);
  background: var(--note);
  border-radius: 0 8px 8px 0;
  color: var(--muted);
}
hr { border: 0; border-top: 1px solid var(--line); margin: 30px 0; }
footer {
  max-width: 860px; margin: 0 auto; padding: 0 20px 40px;
  color: var(--muted); font-size: 12px;
}
@media print {
  .topbar { display: none; }
  body { background: #fff; color: #000; }
  main { max-width: none; padding: 0; }
  h2 { page-break-after: avoid; }
  pre, table, blockquote { page-break-inside: avoid; }
  a { color: #000; text-decoration: underline; }
}
@media (max-width: 520px) {
  main { padding: 20px 14px 60px; }
  h1 { font-size: 23px; }
  h2 { font-size: 19px; }
  table { font-size: 13px; }
  th, td { padding: 6px 8px; }
}
"""

TEMPLATE = """<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>{title}</title>
<style>{css}</style>
</head>
<body>
<div class="topbar">{back}<span class="name">{name}</span></div>
<main>
{body}
</main>
<footer>Сгенерировано из {source} · открывается где угодно, печатается в PDF из браузера.</footer>
</body>
</html>
"""


def first_heading(text: str, fallback: str) -> str:
    m = re.search(r"^#\s+(.+)$", text, flags=re.M)
    return m.group(1).strip() if m else fallback


def convert(src: Path, dst: Path, back: str | None = None) -> None:
    text = src.read_text(encoding="utf-8")
    title = first_heading(text, src.stem)

    body = markdown.markdown(
        text,
        extensions=["tables", "fenced_code", "sane_lists", "toc"],
        output_format="html5",
    )

    back_html = f'<a href="{back}">← назад</a>' if back else ""
    html = TEMPLATE.format(
        title=title,
        css=CSS,
        body=body,
        back=back_html,
        name=src.name,
        source=src.as_posix(),
    )

    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(html, encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description="markdown → автономный HTML")
    ap.add_argument("src", type=Path)
    ap.add_argument("dst", type=Path)
    ap.add_argument("--back", default=None, help="ссылка «назад» в верхней панели")
    args = ap.parse_args()

    if not args.src.is_file():
        sys.stderr.write(f"нет файла: {args.src}\n")
        return 1

    convert(args.src, args.dst, args.back)
    size = args.dst.stat().st_size
    print(f"{args.dst}  ({size/1024:.1f} КБ)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
