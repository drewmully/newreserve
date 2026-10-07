"""Offline transport/date/budget checks. No provider or credential access."""
import datetime as dt
import contextlib
import hashlib
import importlib.util
import io
import json
import pathlib
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("meta_capture", ROOT / "scripts/analytics/capture-meta-hourly.py")
capture = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = capture
SPEC.loader.exec_module(capture)


def binding(**changes):
    value = {
        "version": 1, "cycleId": "00000000-0000-4000-8000-000000000001",
        "grantId": "fixture:cycle-grant", "grantRevision": "1",
        "projectRef": "xnfjdbpjuaezxjgargto", "shop": "mullybox-store.myshopify.com",
        "provider": "meta", "accountId": "2796962933960445", "currency": "USD",
        "timezone": "America/Los_Angeles", "apiVersion": "v25.0", "date": "2026-09-29",
        "notBefore": "2026-10-07T16:00:00Z", "deadline": "2026-10-07T16:01:00Z",
        "freshnessCutoffAt": "2026-10-07T16:00:00Z", "maxRequests": 3, "maxBytes": 10000,
        "accountLimit": 49, "campaignLimit": 1001, "approvalRef": "fixture:approval",
        "actorRef": "fixture:operator", "controlApprovalRef": "fixture:control",
    }
    value.update(changes)
    raw = json.dumps(value).encode()
    return raw, hashlib.sha256(raw).hexdigest()


META = {"id": "act_2796962933960445", "account_id": "2796962933960445",
        "currency": "USD", "timezone_name": "America/Los_Angeles", "account_status": 1,
        "business": {"name": "SECRET_REFLECTION_NOT_A_REPORT_INPUT"}}


class Fake:
    def __init__(self, responses=None, now="2026-10-07T16:00:00Z", durations=None):
        self.utc = capture.instant(now)
        self.elapsed = 0.0
        self.calls = []
        self.responses = responses or [META, {"data": []}, {"data": []}]
        self.durations = durations or [1, 1, 1]

    def clock(self):
        return self.utc

    def monotonic(self):
        return self.elapsed

    def run(self, command, budget, timeout):
        index = len(self.calls)
        self.calls.append((command, budget, timeout))
        seconds = self.durations[index]
        self.elapsed += seconds
        self.utc += dt.timedelta(seconds=seconds)
        value = self.responses[index]
        if isinstance(value, tuple):
            return value
        return json.dumps(value, separators=(",", ":")).encode(), 200

    def capture(self, raw=None, pin=None):
        if raw is None:
            raw, pin = binding()
        return capture.capture(raw, pin, clock=self.clock, monotonic=self.monotonic, runner=self.run)


class WindowTests(unittest.TestCase):
    def test_exact_ny_day_full_pacific_query(self):
        w = capture.ny_window("2026-09-29")
        self.assertEqual((w.since, w.until), ("2026-09-28", "2026-09-29"))
        self.assertEqual(w.report_from.isoformat(), "2026-09-29T04:00:00+00:00")
        self.assertEqual(w.report_until.isoformat(), "2026-09-30T04:00:00+00:00")
        self.assertEqual(w.query_close.isoformat(), "2026-09-30T07:00:00+00:00")

    def test_winter_boundary(self):
        w = capture.ny_window("2026-01-01")
        self.assertEqual(w.report_from.hour, 5)
        self.assertEqual(w.query_close.hour, 8)

    def test_dst_and_invalid_dates_refuse(self):
        for date in ("2026-03-08", "2026-03-09", "2026-11-01", "2026-11-02", "2026-02-30", "20260929"):
            with self.subTest(date=date), self.assertRaises(capture.Refusal):
                capture.ny_window(date)


class BindingTests(unittest.TestCase):
    def test_exact_bytes_not_canonicalized(self):
        raw, pin = binding()
        capture.bind_cycle(raw, pin)
        with self.assertRaisesRegex(capture.Refusal, "hash_mismatch"):
            capture.bind_cycle(raw + b" ", pin)

    def test_no_scope_or_budget_override(self):
        for changes in ({"accountId": "1"}, {"timezone": "America/New_York"}, {"projectRef": "wrong"},
                        {"apiVersion": "v26.0"}, {"maxRequests": 4}, {"maxBytes": capture.MAX_BYTES + 1},
                        {"accountLimit": 50}, {"campaignLimit": 1002}, {"filtering": "[]"}, {"version": True},
                        {"approvalRef": "UNSET"}, {"freshnessCutoffAt": "2026-10-07T15:00:00Z"}):
            fake = Fake()
            with self.subTest(changes=changes), self.assertRaises(capture.Refusal):
                fake.capture(*binding(**changes))
            self.assertEqual(fake.calls, [])

    def test_before_claim_and_expired_refuse_without_calls(self):
        for now in ("2026-10-07T15:59:59.999999Z", "2026-10-07T16:01:00Z"):
            fake = Fake(now=now)
            with self.assertRaisesRegex(capture.Refusal, "cycle_not_current"):
                fake.capture()
            self.assertEqual(fake.calls, [])

    def test_query_not_closed_refuses_without_metadata_call(self):
        fake = Fake(now="2026-09-30T06:59:59.999999Z")
        with self.assertRaisesRegex(capture.Refusal, "query_not_closed"):
            fake.capture(*binding(notBefore="2026-09-30T06:55:00Z", freshnessCutoffAt="2026-09-30T06:55:00Z",
                                  deadline="2026-09-30T07:01:00Z"))
        self.assertEqual(fake.calls, [])


class CaptureTests(unittest.TestCase):
    def test_three_fixed_gets_complete_empty_no_activity_input(self):
        fake = Fake()
        result = fake.capture()
        self.assertEqual(result["summary"]["requests"], 3)
        self.assertFalse(result["summary"]["metricAcceptance"])
        self.assertFalse(result["summary"]["registered"])
        self.assertEqual(result["receipts"]["account-hours"]["response"], {"data": []})
        self.assertEqual(result["receipts"]["campaign-hours"]["response"], {"data": []})
        self.assertNotIn("SECRET_REFLECTION", json.dumps(result))
        for command, budget, timeout in fake.calls:
            self.assertEqual(command[:2], ["curl", "--disable"])
            self.assertEqual(command[command.index("--retry") + 1], "0")
            self.assertNotIn("--insecure", command)
            self.assertNotIn("--proxy", command)
            self.assertNotIn("--location", command)
            self.assertLessEqual(timeout, 20)
            self.assertGreater(budget, 0)
        self.assertIn("limit=49", fake.calls[1][0])
        self.assertIn("limit=1001", fake.calls[2][0])
        self.assertIn('time_range={"since": "2026-09-28", "until": "2026-09-29"}', fake.calls[1][0])

    def test_exact_provider_close_accepted(self):
        fake = Fake(now="2026-09-30T07:00:00Z")
        result = fake.capture(*binding(notBefore="2026-09-30T07:00:00Z", freshnessCutoffAt="2026-09-30T07:00:00Z",
                                       deadline="2026-09-30T07:01:00Z"))
        self.assertEqual(result["summary"]["requests"], 3)

    def test_global_byte_and_time_caps(self):
        fake = Fake()
        with self.assertRaisesRegex(capture.Refusal, "global_byte_budget"):
            fake.capture(*binding(maxBytes=1))
        self.assertEqual(len(fake.calls), 1)
        fake = Fake(durations=[56])
        with self.assertRaisesRegex(capture.Refusal, "cycle_deadline"):
            fake.capture()
        self.assertEqual(len(fake.calls), 1)

    def test_shorter_cycle_deadline_wins(self):
        fake = Fake(durations=[2])
        with self.assertRaisesRegex(capture.Refusal, "cycle_deadline"):
            fake.capture(*binding(deadline="2026-10-07T16:00:01Z"))
        self.assertEqual(fake.calls[0][2], 1)

    def test_frozen_consumer_per_receipt_cap(self):
        fake = Fake(responses=[(b"x" * 1000001, 200)])
        with self.assertRaisesRegex(capture.Refusal, "response_byte_budget"):
            fake.capture(*binding(maxBytes=capture.MAX_BYTES))
        self.assertEqual(fake.calls[0][1], 1000000)

    def test_no_retry_on_http_or_error_body(self):
        for response, code in ((b'{"error":{"message":"SECRET_TOKEN"}}', 429),
                               (b'{"error":{"message":"SECRET_TOKEN"}}', 200)):
            fake = Fake(responses=[(response, code)])
            with self.assertRaises(capture.Refusal) as caught:
                fake.capture()
            self.assertNotIn("SECRET", str(caught.exception))
            self.assertEqual(len(fake.calls), 1)

    def test_no_pagination_and_no_secret_reflection(self):
        fake = Fake(responses=[META, {"data": [], "paging": {"next": "https://x/?access_token=SECRET"}}])
        with self.assertRaisesRegex(capture.Refusal, "pagination_incomplete"):
            fake.capture()
        self.assertEqual(len(fake.calls), 2)
        fake = Fake(responses=[META, {"data": [], "paging": {"previous": "https://x/?access_token=SECRET"}}, {"data": []}])
        self.assertNotIn("SECRET", json.dumps(fake.capture()))

    def test_both_row_sentinels_refuse(self):
        for responses, count in (([META, {"data": [{}] * 49}], 2),
                                 ([META, {"data": []}, {"data": [{}] * 1001}], 3)):
            fake = Fake(responses=responses)
            with self.assertRaisesRegex(capture.Refusal, "row_budget"):
                fake.capture()
            self.assertEqual(len(fake.calls), count)


class PipeTests(unittest.TestCase):
    def test_real_local_subprocess_byte_bound(self):
        with self.assertRaisesRegex(capture.Refusal, "byte_budget"):
            capture.run_curl([sys.executable, "-c", "import sys;sys.stdout.write('x'*1024)"], 20, 2)

    def test_real_local_subprocess_timeout(self):
        with self.assertRaisesRegex(capture.Refusal, "transport_timeout"):
            capture.run_curl([sys.executable, "-c", "import time;time.sleep(2)"], 20, 0.03)

    def test_real_local_subprocess_success(self):
        body, status = capture.run_curl(
            [sys.executable, "-c", "import sys;sys.stdout.write('{\"data\":[]}\\nSTATUS:200')"], 20, 2)
        self.assertEqual((body, status), (b'{"data":[]}', 200))


class OutputTests(unittest.TestCase):
    def test_private_output_modes_and_safe_summary(self):
        with tempfile.TemporaryDirectory() as root:
            path = pathlib.Path(root)
            raw, pin = binding()
            (path / "binding.json").write_bytes(raw)
            argv = ["capture", "--binding", str(path / "binding.json"), "--binding-sha256", pin,
                    "--output", str(path / "output")]
            stdout = io.StringIO()
            with patch.object(sys, "argv", argv), patch.object(capture, "capture", return_value=Fake().capture()), \
                    contextlib.redirect_stdout(stdout):
                self.assertEqual(capture.main(), 0)
            self.assertEqual(stat.S_IMODE((path / "output").stat().st_mode), 0o700)
            self.assertEqual(len(list((path / "output").iterdir())), 4)
            for file in (path / "output").iterdir():
                self.assertEqual(stat.S_IMODE(file.stat().st_mode), 0o600)
                self.assertNotIn("SECRET", file.read_text())
            self.assertNotIn("SECRET", stdout.getvalue())

    def test_existing_output_refuses_before_capture(self):
        with tempfile.TemporaryDirectory() as root:
            argv = ["capture", "--binding", "not-read", "--binding-sha256", "a" * 64, "--output", root]
            with patch.object(sys, "argv", argv), patch.object(capture, "capture") as reader, \
                    contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(capture.main(), 1)
                reader.assert_not_called()


if __name__ == "__main__":
    unittest.main()
