#!/usr/bin/env python3
"""Validate the local-only attendee research dataset without contacting LinkedIn."""

import argparse
from collections import Counter
from datetime import datetime, timedelta
import json
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PATH = ROOT / ".private" / "speed-networking-event" / "attendees.json"
RESEARCH_STATUSES = {"pending", "blocked", "complete"}
MATCH_STATUSES = {"high_confidence", "needs_review", "not_found"}
FACT_FIELDS = {
    "experience": ("title", "organization", "dates", "summary", "source_url"),
    "education": ("institution", "program", "dates", "source_url"),
    "projects": ("name", "summary", "source_url"),
    "skills": ("name", "source_url"),
}


def canonical_profile_url(value):
    """Return a comparison key, or None for a noncanonical LinkedIn profile URL."""
    if not isinstance(value, str):
        return None
    try:
        parsed = urlsplit(value)
    except ValueError:
        return None
    if (
        parsed.scheme != "https"
        or parsed.netloc not in {"linkedin.com", "www.linkedin.com"}
        or parsed.query
        or parsed.fragment
        or not re.fullmatch(r"/in/(?:[A-Za-z0-9_\-]|%[0-9A-Fa-f]{2})+/?", parsed.path)
    ):
        return None
    return "https://www.linkedin.com" + parsed.path.rstrip("/").casefold()


def validate_dataset(data, require_complete=False):
    """Return structural/research-completeness errors; never infer a match."""
    errors = []

    def error(path, message):
        errors.append(f"{path}: {message}")

    def obj(value, path, keys):
        if not isinstance(value, dict):
            error(path, "must be an object")
            return {}
        for key in keys:
            if key not in value:
                error(f"{path}.{key}", "is required")
        return value

    def items(value, path):
        if not isinstance(value, list):
            error(path, "must be an array")
            return []
        return value

    def string(value, path, nullable=False):
        if value is None and nullable:
            return
        if not isinstance(value, str) or not value.strip():
            error(path, "must be a nonempty string" + (" or null" if nullable else ""))
        elif value != value.strip():
            error(path, "must not contain leading or trailing whitespace")

    def timestamp(value, path, nullable=False):
        if value is None and nullable:
            return
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            valid = parsed.utcoffset() == timedelta(0) and "T" in value
        except (AttributeError, TypeError, ValueError):
            valid = False
        if not valid:
            error(path, "must be an ISO 8601 UTC timestamp" + (" or null" if nullable else ""))

    def facts(record, path, source_urls, optional=False):
        populated = False
        for field, keys in FACT_FIELDS.items():
            if optional and field not in record:
                continue
            entries = items(record.get(field), f"{path}.{field}")
            populated = populated or bool(entries)
            for index, value in enumerate(entries):
                entry_path = f"{path}.{field}[{index}]"
                entry = obj(value, entry_path, keys)
                for key in keys:
                    string(entry.get(key), f"{entry_path}.{key}", nullable=key in {"dates", "summary"})
                if not isinstance(entry.get("source_url"), str) or entry["source_url"] not in source_urls:
                    error(f"{entry_path}.source_url", "must reference an attendee sources entry")
        if not optional or "summary" in record:
            string(record.get("summary"), f"{path}.summary", nullable=True)
            if record.get("summary") is not None and not populated:
                error(f"{path}.summary", "requires sourced professional facts")
        return populated

    data = obj(data, "dataset", ("schema_version", "event", "research", "attendees"))
    if type(data.get("schema_version")) is not int or data.get("schema_version") != 1:
        error("dataset.schema_version", "must be 1")
    event = obj(data.get("event"), "event", (
        "id", "name", "organization", "intended_app_url", "cohort", "expected_attendee_count",
    ))
    for key in ("id", "name", "organization", "intended_app_url"):
        string(event.get(key), f"event.{key}")
    cohort = obj(event.get("cohort"), "event.cohort", ("institution", "program"))
    for key in ("institution", "program"):
        string(cohort.get(key), f"event.cohort.{key}")
    expected = event.get("expected_attendee_count")
    if type(expected) is not int or expected < 1:
        error("event.expected_attendee_count", "must be a positive integer")

    research = obj(data.get("research"), "research", (
        "source", "status", "last_attempted_at", "completed_at", "blocker",
    ))
    if research.get("source") != "authenticated_linkedin":
        error("research.source", "must be authenticated_linkedin")
    if research.get("status") not in ("blocked_browser_unavailable", "in_progress", "complete"):
        error("research.status", "has an unsupported value")
    timestamp(research.get("last_attempted_at"), "research.last_attempted_at")
    timestamp(research.get("completed_at"), "research.completed_at", nullable=True)
    string(research.get("blocker"), "research.blocker", nullable=True)
    if research.get("status") == "complete":
        if research.get("completed_at") is None or research.get("blocker") is not None:
            error("research", "complete research requires completed_at and a null blocker")
    elif research.get("completed_at") is not None:
        error("research.completed_at", "must be null until research is complete")
    if research.get("status") == "blocked_browser_unavailable" and not research.get("blocker"):
        error("research.blocker", "must explain the unavailable browser")

    attendees = items(data.get("attendees"), "attendees")
    if type(expected) is int and len(attendees) != expected:
        error("attendees", f"expected {expected} records, found {len(attendees)}")
    seen_ids, seen_names, selected_urls = set(), set(), set()
    incomplete = 0
    for index, value in enumerate(attendees):
        path = f"attendees[{index}]"
        attendee = obj(value, path, (
            "id", "name", "aliases", "research_status", "researched_at", "match",
            *FACT_FIELDS, "summary", "sources",
        ))
        for key, seen in (("id", seen_ids), ("name", seen_names)):
            text = attendee.get(key)
            string(text, f"{path}.{key}")
            if isinstance(text, str):
                normalized = text.casefold()
                if normalized in seen:
                    error(f"{path}.{key}", "must be unique")
                seen.add(normalized)
        for alias_index, alias in enumerate(items(attendee.get("aliases"), f"{path}.aliases")):
            string(alias, f"{path}.aliases[{alias_index}]")

        source_urls = set()
        for source_index, source in enumerate(items(attendee.get("sources"), f"{path}.sources")):
            source_path = f"{path}.sources[{source_index}]"
            source = obj(source, source_path, ("url", "accessed_at", "note"))
            string(source.get("url"), f"{source_path}.url")
            timestamp(source.get("accessed_at"), f"{source_path}.accessed_at")
            string(source.get("note"), f"{source_path}.note")
            if isinstance(source.get("url"), str):
                source_urls.add(source["url"])

        status = attendee.get("research_status")
        if not isinstance(status, str) or status not in RESEARCH_STATUSES:
            error(f"{path}.research_status", "has an unsupported value")
        timestamp(attendee.get("researched_at"), f"{path}.researched_at", nullable=True)
        match = obj(attendee.get("match"), f"{path}.match", ("status", "profile_url", "evidence", "candidates"))
        match_status = match.get("status")
        if match_status is not None and (not isinstance(match_status, str) or match_status not in MATCH_STATUSES):
            error(f"{path}.match.status", "has an unsupported value")
        if status == "complete":
            if match_status is None or attendee.get("researched_at") is None:
                error(path, "complete research requires a match outcome and researched_at")
        else:
            incomplete += 1
            if match_status is not None or attendee.get("researched_at") is not None:
                error(path, "pending or blocked research must have null match.status and researched_at")

        evidence_kinds = set()
        evidence = items(match.get("evidence"), f"{path}.match.evidence")
        for evidence_index, item in enumerate(evidence):
            evidence_path = f"{path}.match.evidence[{evidence_index}]"
            item = obj(item, evidence_path, ("kind", "text", "source_url"))
            kind = item.get("kind")
            if kind not in ("name", "program"):
                error(f"{evidence_path}.kind", "must be name or program")
            else:
                evidence_kinds.add(kind)
            string(item.get("text"), f"{evidence_path}.text")
            string(item.get("source_url"), f"{evidence_path}.source_url")
            if not isinstance(item.get("source_url"), str) or item["source_url"] not in source_urls:
                error(f"{evidence_path}.source_url", "must reference an attendee sources entry")
        if status != "complete" and evidence:
            error(f"{path}.match.evidence", "must be empty until research is complete")

        profile = match.get("profile_url")
        if match_status == "high_confidence":
            canonical = canonical_profile_url(profile)
            if canonical is None:
                error(f"{path}.match.profile_url", "must be a canonical HTTPS LinkedIn /in/ profile URL")
            elif canonical in selected_urls:
                error(f"{path}.match.profile_url", "selected profile must be unique")
            else:
                selected_urls.add(canonical)
            if not {"name", "program"} <= evidence_kinds:
                error(f"{path}.match.evidence", "high confidence requires name and explicit program evidence")
        elif profile is not None:
            error(f"{path}.match.profile_url", "only high_confidence may select a profile")

        candidates = items(match.get("candidates"), f"{path}.match.candidates")
        if match_status == "needs_review" and not candidates:
            error(f"{path}.match.candidates", "needs_review requires at least one candidate")
        for candidate_index, candidate in enumerate(candidates):
            candidate_path = f"{path}.match.candidates[{candidate_index}]"
            candidate = obj(candidate, candidate_path, ("url", "reason", "source_urls"))
            if canonical_profile_url(candidate.get("url")) is None:
                error(f"{candidate_path}.url", "must be a canonical HTTPS LinkedIn /in/ profile URL")
            string(candidate.get("reason"), f"{candidate_path}.reason")
            references = items(candidate.get("source_urls"), f"{candidate_path}.source_urls")
            if not references:
                error(f"{candidate_path}.source_urls", "requires at least one source reference")
            for reference_index, reference in enumerate(references):
                string(reference, f"{candidate_path}.source_urls[{reference_index}]")
            candidate_facts = facts(candidate, candidate_path, source_urls, optional=True)
            if status != "complete" and (candidate_facts or candidate.get("summary") is not None):
                error(candidate_path, "pending or blocked candidates cannot contain researched facts")

        populated = facts(attendee, path, source_urls)
        if match_status != "high_confidence" and (populated or attendee.get("summary") is not None):
            error(path, "professional facts require a high_confidence selected profile; keep candidate facts in candidates")

    if research.get("status") == "complete" and incomplete:
        error("research.status", "cannot be complete while attendee research is incomplete")
    if require_complete and (incomplete or research.get("status") != "complete"):
        error("research", "is incomplete (--require-complete)")
    return errors


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", nargs="?", type=Path, default=DEFAULT_PATH)
    parser.add_argument("--require-complete", action="store_true", help="fail if any research remains incomplete")
    args = parser.parse_args(argv)
    try:
        data = json.loads(args.path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        print(f"Attendee dataset not found: {args.path}. This local-only file is not stored in Git.", file=sys.stderr)
        return 1
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        print(f"Cannot read attendee dataset: {exc}", file=sys.stderr)
        return 1
    errors = validate_dataset(data, require_complete=args.require_complete)
    if errors:
        print("Attendee dataset validation failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    attendees = data["attendees"]
    counts = Counter(attendee["research_status"] for attendee in attendees)
    outcomes = Counter(attendee["match"]["status"] for attendee in attendees if attendee["match"]["status"])
    print(f"Valid attendee dataset: {len(attendees)} records; research status: {data['research']['status']}.")
    print("Research: " + ", ".join(f"{status}={counts[status]}" for status in ("complete", "pending", "blocked")) + ".")
    print("Matches: " + ", ".join(f"{status}={outcomes[status]}" for status in ("high_confidence", "needs_review", "not_found")) + ".")
    return 0


if __name__ == "__main__":
    sys.exit(main())
