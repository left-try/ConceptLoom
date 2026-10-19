import hashlib
import re
from pathlib import Path

from .quality import evaluate_page_quality


def _pdf_text(data):
    text = []
    for match in re.finditer(rb"\((?:\\.|[^\\)])*\)\s*Tj", data):
        literal = match.group(0).rsplit(b"Tj", 1)[0].strip()
        literal = literal[1:-1].replace(b"\\(", b"(").replace(b"\\)", b")").replace(b"\\\\", b"\\")
        text.append(literal.decode("latin-1", errors="replace"))
    return "\n".join(text)


def convert_file(input_path, output_directory, ocr_mode="auto", languages=None, resume_pages=None):
    source = Path(input_path)
    output = Path(output_directory)
    if not source.is_file():
        raise ValueError("inputPath must name an existing file")
    output.mkdir(parents=True, exist_ok=True)
    data = source.read_bytes()
    if data.startswith(b"%PDF"):
        content = _pdf_text(data)
    else:
        content = data.decode("utf-8", errors="replace")
    raw_pages = content.split("\f")
    if raw_pages and not raw_pages[-1].strip() and len(raw_pages) > 1:
        raw_pages.pop()
    wanted = set(resume_pages or range(1, len(raw_pages) + 1))
    pages = []
    for page_number, text in enumerate(raw_pages, 1):
        if page_number not in wanted:
            continue
        text = text.strip()
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
        quality = evaluate_page_quality(text, page_number)
        page = {"page": page_number, "text": text, "blocks": [{"text": text}] if text else [], "contentHash": digest, "quality": quality, "locator": {"page": page_number}}
        pages.append(page)
        (output / f"page-{page_number:06d}.json").write_text(__import__("json").dumps(page, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return pages
