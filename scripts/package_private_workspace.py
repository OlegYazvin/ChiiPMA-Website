"""Create private handoff archives without publishing or bundling credential caches."""
from pathlib import Path
import argparse
import hashlib
import io
import json
import subprocess
import tarfile

SKIP = {"print-tools", "node_modules", ".git", ".wrangler", ".sites-runtime", ".venv", "venv", "__pycache__", "dist", ".next", ".vinext"}


def allowed(path):
    return not any(p in SKIP or p.startswith((".env", ".dev.vars")) for p in path.parts) and path.suffix not in {".pem", ".sqlite", ".db", ".pyc"}


def archive(path, files, note, extra=None):
    manifest = {"format": "chipma-private-workspace-v1", "note": note, "files": {}}
    metadata_dir = ".private/handoff/" + path.name.removesuffix(".tar.gz")
    path.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(path, "w:gz") as output:
        for name, source in sorted(files.items()):
            if source.is_symlink() or not source.is_file():
                raise ValueError(f"Refusing a non-file archive entry: {name}")
            data = source.read_bytes()
            manifest["files"][name] = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
            output.add(source, arcname=name, recursive=False)
        for name, data in {"README.txt": (note + "\n").encode(), **(extra or {})}.items():
            info = tarfile.TarInfo(metadata_dir + "/" + name)
            info.size = len(data)
            output.addfile(info, io.BytesIO(data))
        data = (json.dumps(manifest, indent=2) + "\n").encode()
        info = tarfile.TarInfo(metadata_dir + "/MANIFEST.json")
        info.size = len(data)
        output.addfile(info, io.BytesIO(data))
    with tarfile.open(path) as saved:
        for name, record in manifest["files"].items():
            assert hashlib.sha256(saved.extractfile(name).read()).hexdigest() == record["sha256"]
    return {"path": str(path), "files": len(files), "bytes": path.stat().st_size, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", type=Path, required=True)
    parser.add_argument("--output-directory", type=Path, required=True)
    args = parser.parse_args()
    root, out = args.repository.resolve(), args.output_directory.resolve()
    research_root = root / ".private/speed-networking-event"
    files = {str(p.relative_to(root)): p for p in research_root.rglob("*") if p.is_file() and not p.is_symlink() and allowed(p.relative_to(research_root))}
    print_root = root / "artifacts/chipma-number-pages"
    files.update({str(p.relative_to(root)): p for p in print_root.rglob("*") if p.is_file() and not p.is_symlink() and allowed(p.relative_to(print_root))})
    requirements = []
    for metadata in sorted((research_root / "print-tools").glob("*.dist-info/METADATA")):
        values = {}
        for line in metadata.read_text(errors="replace").splitlines():
            if line.startswith(("Name: ", "Version: ")):
                key, value = line.split(": ", 1)
                values[key] = value
        if "Name" in values and "Version" in values:
            requirements.append(values["Name"] + "==" + values["Version"])
    note = "Private research, scripts, notes, print files and validation history. Extract into a repository checkout to restore ignored .private working copies. Runtime event state remains authoritative in the hosted admin; download a fresh current-event backup before editing it. Reinstall print dependencies from requirements-print-tools.txt; platform-specific caches are excluded."
    research = archive(out / "ChiPMA-private-research-workspace.tar.gz", files, note, {"requirements-print-tools.txt": ("\n".join(requirements) + "\n").encode()})
    git = lambda *cmd: subprocess.check_output(["git", *cmd], cwd=root, text=True)
    remote = {}
    for line in git("ls-tree", "-r", "origin/main").splitlines():
        meta, name = line.split("\t", 1)
        remote[name] = meta.split()[2]
    candidates = set(git("diff", "--name-only").splitlines() + git("ls-files", "--others", "--exclude-standard").splitlines())
    overlay = {}
    for name in sorted(candidates):
        p = root / name
        if not p.is_file() or p.is_symlink() or not allowed(Path(name)) or name.startswith(".event-apps/"):
            continue
        current = git("hash-object", name).strip()
        if remote.get(name) != current:
            overlay[name] = p
    tracked = [p for p in overlay if p in remote]
    patch = subprocess.check_output(["git", "diff", "--binary", "origin/main", "--", *tracked], cwd=root) if tracked else b""
    note = "Unpublished website work preserved for review, not merged or deployed. Files are snapshots relative to origin/main at " + git("rev-parse", "origin/main").strip() + ". Extracting keeps the overlay under .private/handoff/unpublished-overlay. Review individual files before copying them into the website. The private working-tree.patch covers tracked differences; the overlay also preserves untracked history pages, print assets and draft artifacts."
    unfinished = archive(out / "ChiPMA-unpublished-website-work.tar.gz", {".private/handoff/unpublished-overlay/" + name: p for name, p in overlay.items()}, note, {"working-tree.patch": patch})
    report = {"research": research, "unpublished": unfinished, "excluded_dependencies": ".private/speed-networking-event/print-tools", "print_dependency_versions": len(requirements)}
    (out / "workspace-package-validation.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
