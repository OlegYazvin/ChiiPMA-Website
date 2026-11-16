import copy
import io
import json
from pathlib import Path
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout

from scripts import validate_attendees as validator


TIMESTAMP = "2026-01-02T03:04:05Z"
PROFILE = "https://www.linkedin.com/in/example-attendee/"


def blocked_dataset():
    return {
        "schema_version": 1,
        "event": {
            "id": "example-event", "name": "Example event", "organization": "Example association",
            "intended_app_url": "https://example.org/networking", "expected_attendee_count": 1,
            "cohort": {"institution": "Example university", "program": "Example design program"},
        },
        "research": {
            "source": "authenticated_linkedin", "status": "blocked_browser_unavailable",
            "last_attempted_at": TIMESTAMP, "completed_at": None, "blocker": "No browser session is available.",
        },
        "attendees": [{
            "id": "student-01", "name": "Example Attendee", "aliases": [],
            "research_status": "blocked", "researched_at": None,
            "match": {"status": None, "profile_url": None, "evidence": [], "candidates": []},
            "experience": [], "education": [], "projects": [], "skills": [], "summary": None, "sources": [],
        }],
    }


def complete_dataset():
    data = blocked_dataset()
    data["research"].update(status="complete", completed_at=TIMESTAMP, blocker=None)
    attendee = data["attendees"][0]
    attendee.update(research_status="complete", researched_at=TIMESTAMP)
    attendee["match"].update(status="high_confidence", profile_url=PROFILE, evidence=[
        {"kind": "name", "text": "Example Attendee", "source_url": PROFILE},
        {"kind": "program", "text": "Example university, Example design program", "source_url": PROFILE},
    ])
    attendee["experience"] = [{
        "title": "Example role", "organization": "Example organization", "dates": None,
        "summary": None, "source_url": PROFILE,
    }]
    attendee["summary"] = "Experience in an example role."
    attendee["sources"] = [{"url": PROFILE, "accessed_at": TIMESTAMP, "note": "Authenticated profile view."}]
    return data


class AttendeeValidationTests(unittest.TestCase):
    def assert_invalid(self, data, fragment):
        errors = validator.validate_dataset(data)
        self.assertTrue(any(fragment in error for error in errors), errors)

    def test_blocked_data_is_valid_but_truthfully_incomplete(self):
        data = blocked_dataset()
        data["attendees"][0]["match"]["candidates"] = [{
            "url": PROFILE, "reason": "Existing local link, not yet verified.",
            "source_urls": ["existing-local-file.html"],
        }]
        self.assertEqual(validator.validate_dataset(data), [])
        self.assertTrue(validator.validate_dataset(data, require_complete=True))
        data["attendees"][0]["match"]["status"] = "not_found"
        self.assert_invalid(data, "null match.status")

    def test_complete_match_requires_identity_program_and_sources(self):
        data = complete_dataset()
        self.assertEqual(validator.validate_dataset(data, require_complete=True), [])
        data["attendees"][0]["match"]["evidence"].pop()
        self.assert_invalid(data, "explicit program evidence")
        data = complete_dataset()
        data["attendees"][0]["sources"] = []
        self.assert_invalid(data, "must reference an attendee sources entry")

    def test_selected_url_requires_canonical_profile_and_unique_person(self):
        for url in ("http://www.linkedin.com/in/example/", "https://www.linkedin.com/company/example/", PROFILE + "?tracking=1"):
            with self.subTest(url=url):
                data = complete_dataset()
                data["attendees"][0]["match"]["profile_url"] = url
                self.assert_invalid(data, "canonical HTTPS LinkedIn")
        data = complete_dataset()
        duplicate = copy.deepcopy(data["attendees"][0])
        duplicate.update(id="student-02", name="Another Example")
        duplicate["match"]["profile_url"] = "https://linkedin.com/in/EXAMPLE-ATTENDEE"
        data["attendees"].append(duplicate)
        data["event"]["expected_attendee_count"] = 2
        self.assert_invalid(data, "selected profile must be unique")

    def test_roster_count_identity_and_timestamp_validation(self):
        data = blocked_dataset()
        data["event"]["expected_attendee_count"] = 2
        self.assert_invalid(data, "expected 2 records")
        data["attendees"].append(copy.deepcopy(data["attendees"][0]))
        self.assert_invalid(data, "must be unique")
        data["research"]["last_attempted_at"] = "2026-01-02T03:04:05"
        self.assert_invalid(data, "ISO 8601 UTC")

    def test_ambiguous_facts_remain_on_candidate(self):
        data = complete_dataset()
        attendee = data["attendees"][0]
        attendee["match"].update(status="needs_review", profile_url=None, candidates=[{
            "url": PROFILE, "reason": "Program identity needs review.", "source_urls": [PROFILE],
            "experience": attendee["experience"], "summary": attendee["summary"],
        }])
        self.assert_invalid(data, "professional facts require a high_confidence")
        attendee.update(experience=[], summary=None)
        self.assertEqual(validator.validate_dataset(data), [])
        attendee["match"]["candidates"] = []
        self.assert_invalid(data, "needs_review requires at least one candidate")

    def test_incomplete_research_cannot_claim_completion_or_facts(self):
        data = blocked_dataset()
        data["research"].update(status="complete", completed_at=TIMESTAMP, blocker=None)
        self.assert_invalid(data, "cannot be complete")
        data = blocked_dataset()
        data["attendees"][0]["summary"] = "An unsupported summary."
        self.assert_invalid(data, "requires sourced professional facts")

    def test_malformed_top_level_is_reported_without_exception(self):
        self.assertTrue(validator.validate_dataset([]))
        data = blocked_dataset()
        data["attendees"] = [None]
        self.assertTrue(validator.validate_dataset(data))
        data = complete_dataset()
        data["research"]["status"] = []
        data["attendees"][0]["research_status"] = []
        data["attendees"][0]["match"]["status"] = []
        data["attendees"][0]["match"]["evidence"][0].update(kind=[], source_url=[])
        data["attendees"][0]["experience"][0]["source_url"] = []
        self.assertTrue(validator.validate_dataset(data))

    def test_cli_missing_local_file_and_incomplete_counts(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "attendees.json"
            stderr = io.StringIO()
            with redirect_stderr(stderr):
                self.assertEqual(validator.main([str(path)]), 1)
            self.assertIn("local-only file is not stored in Git", stderr.getvalue())
            path.write_text(json.dumps(blocked_dataset()), encoding="utf-8")
            stdout = io.StringIO()
            with redirect_stdout(stdout):
                self.assertEqual(validator.main([str(path)]), 0)
            self.assertIn("complete=0, pending=0, blocked=1", stdout.getvalue())
            self.assertIn("not_found=0", stdout.getvalue())
            with redirect_stderr(io.StringIO()):
                self.assertEqual(validator.main([str(path), "--require-complete"]), 1)


if __name__ == "__main__":
    unittest.main()
