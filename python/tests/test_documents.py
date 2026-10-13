import unittest
import json
from pathlib import Path

from conceptloom_documents.quality import evaluate_page_quality


class PageQualityTests(unittest.TestCase):
    def test_clear_extracted_text_is_usable_without_fabricated_confidence(self):
        result = evaluate_page_quality(
            "A vector has magnitude and direction. A matrix maps vectors.",
            page=1,
            blocks=[{"text": "A vector has magnitude and direction.", "bbox": [0, 0, 100, 20]}],
        )
        self.assertEqual(result["status"], "usable")
        self.assertTrue(result["usableForEvidence"])
        self.assertEqual(result["signals"], [])
        self.assertNotIn("confidence", result)

    def test_empty_page_is_failed_and_cannot_be_used_as_evidence(self):
        result = evaluate_page_quality("\n  ", page=2, blocks=[])
        self.assertEqual(result["status"], "failed")
        self.assertFalse(result["usableForEvidence"])
        self.assertIn("empty_text", [signal["code"] for signal in result["signals"]])

    def test_replacement_characters_require_manual_review(self):
        result = evaluate_page_quality("The eig\uFFFDnvector is corrupted.", page=3)
        self.assertEqual(result["status"], "needs-review")
        self.assertFalse(result["usableForEvidence"])
        self.assertIn("replacement_characters", [signal["code"] for signal in result["signals"]])

    def test_suspicious_block_order_is_a_signal_not_a_quality_score(self):
        result = evaluate_page_quality(
            "Right column first. Left column second.",
            page=4,
            blocks=[
                {"text": "Right column first.", "bbox": [300, 0, 500, 100]},
                {"text": "Left column second.", "bbox": [0, 0, 200, 100]},
            ],
        )
        codes = [signal["code"] for signal in result["signals"]]
        self.assertIn("suspicious_block_order", codes)
        self.assertNotIn("confidence", result)
        self.assertEqual(result["status"], "needs-review")

    def test_quality_evaluation_preserves_page_identity_and_locator(self):
        result = evaluate_page_quality("Printed page label.", page=11, printed_page="xv")
        self.assertEqual(result["page"], 11)
        self.assertEqual(result["printedPage"], "xv")

    def test_unknown_or_missing_extraction_is_not_marked_usable(self):
        result = evaluate_page_quality(None, page=5)
        self.assertNotEqual(result["status"], "usable")
        self.assertFalse(result["usableForEvidence"])

    def test_synthetic_ru_en_fixture_manifest_matches_quality_contract(self):
        manifest = json.loads((Path(__file__).parents[2] / "test" / "fixtures" / "documents" / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(len(manifest["cases"]), 12)
        self.assertEqual({row["language"] for row in manifest["cases"]}, {"en", "ru"})
        for row in manifest["cases"]:
            with self.subTest(case=row["id"]):
                result = evaluate_page_quality(
                    row["text"], page=row["page"], blocks=row.get("blocks", []),
                    printed_page=row.get("printedPage"), orientation=row.get("orientation"),
                )
                self.assertEqual(result["status"], row["expectedStatus"])
                self.assertEqual(sorted(signal["code"] for signal in result["signals"]), sorted(row["expectedSignals"]))


if __name__ == "__main__":
    unittest.main()
