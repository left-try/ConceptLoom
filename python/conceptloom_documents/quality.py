import re


def evaluate_page_quality(text, page, blocks=None, printed_page=None, orientation=None):
    signals = []
    value = text if isinstance(text, str) else ""
    if not value.strip():
        signals.append({"code": "empty_text", "message": "No readable text was extracted."})
        status = "failed"
    else:
        if "\ufffd" in value:
            signals.append({"code": "replacement_characters", "message": "Text contains Unicode replacement characters."})
        if blocks and len(blocks) > 1:
            boxes = [block.get("bbox") for block in blocks if isinstance(block.get("bbox"), (list, tuple)) and len(block["bbox"]) >= 4]
            if any(float(right[0]) < float(left[0]) for left, right in zip(boxes, boxes[1:])):
                signals.append({"code": "suspicious_block_order", "message": "Text block order may not match the page reading order."})
        status = "needs-review" if signals else "usable"
    result = {"status": status, "usableForEvidence": status == "usable", "signals": signals, "page": page}
    if printed_page is not None:
        result["printedPage"] = printed_page
    if orientation is not None and orientation not in (0, 90, 180, 270):
        result["signals"].append({"code": "unexpected_orientation", "message": "Page orientation is outside expected right angles."})
        result["status"] = "needs-review"
        result["usableForEvidence"] = False
    return result
