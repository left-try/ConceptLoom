import json
import sys
import traceback
from pathlib import Path

from .convert import convert_file


def main():
    try:
        request = json.load(sys.stdin)
        required = {"schemaVersion", "inputPath", "outputDirectory", "ocrMode", "languages"}
        if not isinstance(request, dict) or request.get("schemaVersion") != 1 or not required.issubset(request):
            raise ValueError("invalid request: schemaVersion must be 1 and required fields must be present")
        if request["ocrMode"] not in ("auto", "on", "off") or not isinstance(request["languages"], list):
            raise ValueError("invalid request: unsupported OCR mode or languages")
        output = Path(request["outputDirectory"]).resolve()
        output.mkdir(parents=True, exist_ok=True)
        resume = request.get("resumeFrom")
        pages = convert_file(request["inputPath"], output, request["ocrMode"], request["languages"], resume.get("pages") if isinstance(resume, dict) else None)
        for page in pages:
            print(json.dumps({"type": "progress", "page": page["page"]}), flush=True)
        print(json.dumps({"type": "result", "pages": pages}), flush=True)
        return 0
    except Exception as error:
        print(f"document conversion failed: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
