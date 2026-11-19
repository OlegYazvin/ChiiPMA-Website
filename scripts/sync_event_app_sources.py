"""Mirror clean, deployed Sites checkouts into the repository's hidden source directory."""
from pathlib import Path
import argparse
import hashlib
import json
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
PROJECTS = {"organizer": "appgprj_6afa77820b388191a3f24d31a335e2e7", "results": "appgprj_6afa77922b508191a08b3a1c1896b020"}
BLOCKED = {".git", ".private", ".wrangler", ".sites-runtime", "node_modules", "dist", ".next", ".vinext", "__pycache__"}


def mirror(source: Path, destination: Path, project_id: str):
    source = source.resolve()
    git = lambda *args: subprocess.check_output(["git", *args], cwd=source, text=True).strip()
    if Path(git("rev-parse", "--show-toplevel")).resolve() != source or git("status", "--porcelain"):
        raise ValueError("Use a clean, published Sites checkout, not the parent website repository")
    paths = [p for p in git("ls-files", "-z").split("\0") if p]
    prepared = []
    for name in paths:
        path = Path(name)
        if any(p in BLOCKED or p.startswith((".env", ".dev.vars")) for p in path.parts) or path.suffix in {".pem", ".sqlite", ".db"}:
            raise ValueError(f"Refusing private or generated source path: {name}")
        original = source / path
        if original.is_symlink():
            raise ValueError(f"Refusing a source symlink: {name}")
        data = original.read_bytes()
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            if path.suffix not in {".wasm", ".woff2"}:
                raise ValueError(f"Review the binary asset before publishing: {name}")
        else:
            if re.search(r'"siwc_bypass_bearer_token"\s*:\s*"[^"\s]+"', text) or re.search(r"(?:RESULTS_WRITE_KEY|PARTICIPANT_LINK_SECRET)\s*[:=]\s*['\"](?!synthetic)[^'\"\s]{12,}", text):
                raise ValueError(f"Refusing a credential-bearing source file: {name}")
        prepared.append((name, data))
    for name, data in prepared:
        output = destination / name
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(data)
    manifest_path = destination.parent / "source-manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {"schema_version": 1, "projects": {}}
    previous = manifest["projects"].get(destination.name, {})
    for name in previous.get("files", {}):
        if name not in {p for p, _ in prepared}:
            (destination / name).unlink(missing_ok=True)
    item = {"project_id": project_id, "source_commit": git("rev-parse", "HEAD"), "files": {name: hashlib.sha256(data).hexdigest() for name, data in prepared}}
    manifest["projects"][destination.name] = item
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    return len(prepared)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--organizer-source", type=Path, default=ROOT / ".private/sites/networking-organizer")
    parser.add_argument("--results-source", type=Path, default=ROOT / ".private/sites/networking-results")
    args = parser.parse_args()
    for name, source in [("organizer", args.organizer_source), ("results", args.results_source)]:
        print(f"Mirrored {mirror(source, ROOT / '.event-apps' / name, PROJECTS[name])} {name} source files")


if __name__ == "__main__":
    main()
