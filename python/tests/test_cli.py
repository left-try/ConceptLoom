import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


PACKAGE_ROOT = Path(__file__).parents[1]


class DocumentWorkerCliTests(unittest.TestCase):
    def run_worker(self, request):
        environment = os.environ.copy()
        environment["PYTHONPATH"] = str(PACKAGE_ROOT) + os.pathsep + environment.get("PYTHONPATH", "")
        return subprocess.run(
            [sys.executable, "-m", "conceptloom_documents"],
            cwd=PACKAGE_ROOT,
            input=json.dumps(request),
            text=True,
            capture_output=True,
            timeout=20,
            env=environment,
            check=False,
        )

    def test_plain_text_request_emits_jsonl_progress_and_one_result(self):
        with tempfile.TemporaryDirectory(prefix="conceptloom-doc-worker-") as directory:
            root = Path(directory)
            source = root / "lesson.txt"
            output = root / "prepared"
            source.write_text("A vector has magnitude and direction.\n", encoding="utf-8")
            completed = self.run_worker({
                "schemaVersion": 1,
                "inputPath": str(source),
                "outputDirectory": str(output),
                "ocrMode": "off",
                "languages": ["en"],
            })
            self.assertEqual(completed.returncode, 0, completed.stderr)
            lines = [line for line in completed.stdout.splitlines() if line.strip()]
            events = [json.loads(line) for line in lines]
            self.assertTrue(any(event.get("type") == "progress" for event in events))
            results = [event for event in events if event.get("type") == "result"]
            self.assertEqual(len(results), 1)
            page = results[0]["pages"][0]
            self.assertEqual(page["page"], 1)
            self.assertIn("magnitude and direction", page["text"])
            self.assertTrue(page["contentHash"])

    def test_invalid_request_fails_without_writing_outside_workspace(self):
        with tempfile.TemporaryDirectory(prefix="conceptloom-doc-worker-") as directory:
            root = Path(directory)
            output = root / "prepared"
            completed = self.run_worker({
                "schemaVersion": 9,
                "inputPath": str(root / "missing.pdf"),
                "outputDirectory": str(output),
                "ocrMode": "auto",
                "languages": ["en", "ru"],
            })
            self.assertNotEqual(completed.returncode, 0)
            self.assertNotIn("No module named conceptloom_documents", completed.stderr)
            self.assertRegex(completed.stderr + completed.stdout, r"schemaVersion|schema version|invalid request")
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
