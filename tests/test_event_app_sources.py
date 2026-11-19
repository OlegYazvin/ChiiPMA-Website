from pathlib import Path
import importlib.util
import json
import subprocess
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("sync_event_app_sources", ROOT / "scripts/sync_event_app_sources.py")
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)


class EventAppPortabilityTests(unittest.TestCase):
    def test_mirrored_app_sources_match_their_manifest_and_contain_no_private_files(self):
        manifest_path = ROOT / ".event-apps/source-manifest.json"
        self.assertTrue(manifest_path.exists(), "Mirror the published Sites sources before publishing the handoff")
        import hashlib
        manifest = json.loads(manifest_path.read_text())
        for name, project in manifest["projects"].items():
            self.assertIn(name, {"organizer", "results"})
            self.assertEqual(len(project["source_commit"]), 40)
            for path, sha in project["files"].items():
                self.assertFalse(set(Path(path).parts) & sync.BLOCKED, path)
                self.assertNotIn(Path(path).name, {"attendees.json", "all-attendees.json", "scheduling-input.json"})
                self.assertFalse(Path(path).name.startswith((".env", ".dev.vars")), path)
                self.assertEqual(hashlib.sha256((ROOT / ".event-apps" / name / path).read_bytes()).hexdigest(), sha)

    def test_hidden_source_apps_are_excluded_from_the_pages_artifact(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "site/.event-apps/organizer").mkdir(parents=True)
            (root / "site/.event-apps/organizer/server.js").write_text("synthetic server code")
            (root / "site/index.html").write_text("public positive control")
            archive = root / "pages.tar"
            subprocess.run(["tar", "--directory", str(root / "site"), "--exclude=.[^/]*", "--create", "--file", str(archive), "."], check=True, capture_output=True)
            with tarfile.open(archive) as saved:
                paths = saved.getnames()
            self.assertIn("./index.html", paths)
            self.assertFalse(any(".event-apps" in Path(path).parts for path in paths))

    def test_source_export_rejects_tracked_environment_files(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "source"
            source.mkdir()
            subprocess.run(["git", "init", "-q"], cwd=source, check=True)
            (source / ".env").write_text("SYNTHETIC_PRIVATE_SETTING=example\n")
            subprocess.run(["git", "add", ".env"], cwd=source, check=True)
            subprocess.run(["git", "-c", "user.name=Synthetic", "-c", "user.email=synthetic@example.invalid", "commit", "-qm", "Synthetic fixture"], cwd=source, check=True)
            with self.assertRaisesRegex(ValueError, "private or generated"):
                sync.mirror(source, Path(folder) / "mirror/organizer", "synthetic-project")


if __name__ == "__main__":
    unittest.main()
