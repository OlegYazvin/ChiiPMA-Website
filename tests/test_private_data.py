from pathlib import Path
import re
import subprocess
import tarfile
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


class PrivateResearchBoundaryTests(unittest.TestCase):
    def test_private_directory_and_nested_records_are_ignored_and_untracked(self):
        paths = [
            ".private/",
            ".private/speed-networking-event/attendees.json",
            ".private/speed-networking-event/notes/review.md",
        ]
        ignored = subprocess.run(
            ["git", "check-ignore", "--no-index", "--stdin"],
            cwd=ROOT, input="\n".join(paths) + "\n", text=True,
            capture_output=True, check=False,
        )
        self.assertEqual(ignored.returncode, 0, ignored.stderr)
        self.assertEqual(ignored.stdout.splitlines(), paths)
        tracked = subprocess.run(
            ["git", "ls-files", "--", ".private"],
            cwd=ROOT, text=True, capture_output=True, check=True,
        )
        self.assertEqual(tracked.stdout, "", "Local research must never be tracked")

    def test_pages_artifact_excludes_private_files_independently_of_gitignore(self):
        workflow = (ROOT / ".github/workflows/refresh-blog.yml").read_text(encoding="utf-8")
        self.assertIn("actions/upload-pages-artifact@v4", workflow)
        # v4's tar command excludes dot-prefixed paths. This fixture has no .gitignore,
        # so exclusion is verified independently of the version-control boundary.
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            source = directory / "site"
            private = source / ".private/speed-networking-event"
            private.mkdir(parents=True)
            (private / "attendees.json").write_text('{"synthetic": true}\n', encoding="utf-8")
            (private / "review.md").write_text("Synthetic review notes\n", encoding="utf-8")
            (source / "index.html").write_text("<p>Public control</p>\n", encoding="utf-8")
            archive = directory / "artifact.tar"
            subprocess.run(
                [
                    "tar", "--dereference", "--hard-dereference",
                    "--directory", str(source), "--exclude=.git", "--exclude=.github",
                    "--exclude=.[^/]*", "--create", "--file", str(archive), ".",
                ],
                check=True, capture_output=True, text=True,
            )
            with tarfile.open(archive) as artifact:
                members = artifact.getnames()
            self.assertIn("./index.html", members)
            self.assertFalse(
                any(".private" in Path(member).parts for member in members),
                members,
            )

    def test_public_files_and_generator_do_not_reference_private_research(self):
        suffixes = {".html", ".css", ".js", ".mjs", ".json", ".xml", ".txt"}
        public_files = [
            path for path in ROOT.rglob("*")
            if path.is_file() and path.suffix in suffixes
            and not any(part.startswith(".") for part in path.relative_to(ROOT).parts)
            and path.relative_to(ROOT).parts[0] not in {"tests", "scripts"}
        ]
        public_files.append(ROOT / "scripts/update_blog.py")
        self.assertIn(ROOT / "index.html", public_files)
        private_reference = re.compile(r"\.private\b|attendees\.json", re.IGNORECASE)
        for path in public_files:
            with self.subTest(path=path.relative_to(ROOT)):
                self.assertNotRegex(path.read_text(encoding="utf-8"), private_reference)

    def test_branch_pages_preserves_jekyll_hidden_directory_exclusion(self):
        self.assertFalse(
            (ROOT / ".nojekyll").exists(),
            "Disabling Jekyll requires a separate private-directory deployment boundary",
        )
        for config in (ROOT / "_config.yml", ROOT / "_config.yaml"):
            if config.exists():
                self.assertNotRegex(
                    config.read_text(encoding="utf-8"), r"(?m)^\s*include\s*:",
                    "Review any Jekyll include override before allowing hidden local research",
                )


if __name__ == "__main__":
    unittest.main()
