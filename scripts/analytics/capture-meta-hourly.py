#!/usr/bin/env python3
"""One Computer-operated Meta capture, bound to an immutable cycle receipt.

No credential handling, registration, activation, retries, pagination or network
access at import. The operator supplies the independently retained binding SHA.
Run under the existing meta_ads credential preset; curl inherits its transport.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
import re
import select
import subprocess
import sys
import time
import uuid
from dataclasses import dataclass
from types import MappingProxyType
from zoneinfo import ZoneInfo

UTC = dt.timezone.utc
NY = ZoneInfo("America/New_York")
LA = ZoneInfo("America/Los_Angeles")
ROOT = "https://graph.facebook.com/v25.0"
ACCOUNT = "2796962933960445"
MAX_BYTES = 8 * 1024 * 1024
MAX_BODY_BYTES = 1000000  # Same per-receipt ceiling as the frozen TS consumer.
MAX_SECONDS = 55
META_FIELDS = "id,account_id,currency,timezone_name,account_status,business"
HOUR_FIELD = "hourly_stats_aggregated_by_advertiser_time_zone"
BINDING_KEYS = {
    "version", "cycleId", "grantId", "grantRevision", "projectRef", "shop",
    "provider", "accountId", "currency", "timezone", "apiVersion", "date",
    "notBefore", "deadline", "freshnessCutoffAt", "maxRequests", "maxBytes",
    "accountLimit", "campaignLimit", "approvalRef", "actorRef", "controlApprovalRef",
}


class Refusal(Exception):
    """Only constant, non-source stage codes may leave the capture process."""


def require(condition, code):
    if not condition:
        raise Refusal(code)


def strict_json(raw):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, "duplicate_json_key")
            result[key] = value
        return result
    try:
        return json.loads(raw, object_pairs_hook=unique)
    except Refusal:
        raise
    except (ValueError, TypeError, RecursionError, UnicodeError):
        raise Refusal("invalid_json") from None


def instant(value):
    require(isinstance(value, str) and re.fullmatch(
        r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|\+00:00)", value), "invalid_clock")
    try:
        return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise Refusal("invalid_clock") from None


def now_utc():
    return dt.datetime.now(UTC)


def reference(value):
    return (isinstance(value, str) and 0 < len(value) <= 512 and value == value.strip()
            and not re.search(r"[\x00-\x1f\x7f]", value)
            and value.upper() != "UNSET")


@dataclass(frozen=True)
class Window:
    report_from: dt.datetime
    report_until: dt.datetime
    since: str
    until: str
    query_close: dt.datetime


def ny_window(day):
    require(isinstance(day, str) and re.fullmatch(r"\d{4}-\d\d-\d\d", day), "invalid_day")
    try:
        date = dt.date.fromisoformat(day)
        start = dt.datetime.combine(date, dt.time(), NY).astimezone(UTC)
        end = dt.datetime.combine(date + dt.timedelta(days=1), dt.time(), NY).astimezone(UTC)
        first = start.astimezone(LA).date()
        last = (end - dt.timedelta(hours=1)).astimezone(LA).date()
        provider_start = dt.datetime.combine(first, dt.time(), LA).astimezone(UTC)
        close = dt.datetime.combine(last + dt.timedelta(days=1), dt.time(), LA).astimezone(UTC)
    except (ValueError, OverflowError):
        raise Refusal("invalid_day") from None
    require(end - start == dt.timedelta(hours=24), "dst_window_unsupported")
    require(close - provider_start == dt.timedelta(days=(last - first).days + 1), "dst_window_unsupported")
    require((last - first).days == 1, "provider_window_shape")
    return Window(start, end, first.isoformat(), last.isoformat(), close)


@dataclass(frozen=True)
class BoundCycle:
    values: MappingProxyType
    sha256: str
    window: Window
    not_before: dt.datetime
    deadline: dt.datetime


def bind_cycle(raw, expected_sha256):
    require(isinstance(raw, bytes) and len(raw) <= 16384, "binding_size")
    require(isinstance(expected_sha256, str) and re.fullmatch(r"[a-f0-9]{64}", expected_sha256),
            "binding_pin_missing")
    actual = hashlib.sha256(raw).hexdigest()
    require(actual == expected_sha256, "binding_hash_mismatch")
    value = strict_json(raw)
    require(isinstance(value, dict) and set(value) == BINDING_KEYS, "binding_shape")
    fixed = {
        "version": 1, "projectRef": "xnfjdbpjuaezxjgargto",
        "shop": "mullybox-store.myshopify.com", "provider": "meta", "accountId": ACCOUNT,
        "currency": "USD", "timezone": "America/Los_Angeles", "apiVersion": "v25.0",
        "maxRequests": 3, "accountLimit": 49, "campaignLimit": 1001,
    }
    require(all(type(value[k]) is type(v) and value[k] == v for k, v in fixed.items()), "binding_scope")
    require(type(value["maxBytes"]) is int and 1 <= value["maxBytes"] <= MAX_BYTES, "binding_byte_budget")
    require(reference(value["grantId"]) and re.fullmatch(r"[A-Za-z0-9:_-]{1,128}", value["grantId"]),
            "binding_grant")
    require(isinstance(value["grantRevision"], str) and
            re.fullmatch(r"(?:0|[1-9]\d{0,19})", value["grantRevision"]), "binding_revision")
    require(all(reference(value[k]) for k in ("approvalRef", "actorRef", "controlApprovalRef")), "binding_approval")
    try:
        require(str(uuid.UUID(value["cycleId"])) == value["cycleId"], "binding_cycle")
    except (ValueError, TypeError, AttributeError):
        raise Refusal("binding_cycle") from None
    not_before, deadline = instant(value["notBefore"]), instant(value["deadline"])
    require(not_before < deadline and instant(value["freshnessCutoffAt"]) == not_before, "binding_clock")
    return BoundCycle(MappingProxyType(value), actual, ny_window(value["date"]), not_before, deadline)


def run_curl(command, body_limit, timeout):
    """Bound stdout in RAM even if upstream headers omit Content-Length."""
    deadline = time.monotonic() + timeout
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    output = bytearray()
    try:
        while True:
            left = deadline - time.monotonic()
            require(left > 0, "transport_timeout")
            readable, _, _ = select.select([process.stdout], [], [], min(left, 0.1))
            if not readable:
                continue
            chunk = os.read(process.stdout.fileno(), min(65536, body_limit + 32 - len(output) + 1))
            if not chunk:
                break
            output.extend(chunk)
            require(len(output) <= body_limit + 32, "transport_byte_budget")
        require(process.wait(timeout=max(0.001, deadline - time.monotonic())) == 0, "curl_failed")
        body, marker, status = bytes(output).rpartition(b"\nSTATUS:")
        require(marker and re.fullmatch(rb"\d{3}", status), "transport_status")
        require(len(body) <= body_limit, "transport_byte_budget")
        return body, int(status)
    except subprocess.TimeoutExpired:
        raise Refusal("transport_timeout") from None
    finally:
        if process.poll() is None:
            process.kill()
        process.wait()
        process.stdout.close()


def safe_response(value, level, ceiling):
    """Keep only typed reporting values; never retain error or paging URLs."""
    require(isinstance(value, dict) and "error" not in value, "provider_error")
    if level is None:
        require(value.get("id") == "act_" + ACCOUNT and value.get("account_id") == ACCOUNT
                and value.get("currency") == "USD" and value.get("timezone_name") == "America/Los_Angeles"
                and type(value.get("account_status")) is int and value["account_status"] == 1, "account_scope")
        # Business display names are not inputs and may contain arbitrary text.
        return {k: value[k] for k in ("id", "account_id", "currency", "timezone_name", "account_status")}
    require(set(value) <= {"data", "paging"} and isinstance(value.get("data"), list), "insights_shape")
    require(len(value["data"]) <= ceiling, "row_budget")
    if "paging" in value:
        require(isinstance(value["paging"], dict) and "next" not in value["paging"], "pagination_incomplete")
    keys = {"account_id", "account_currency", "date_start", "date_stop", "spend", "clicks", "impressions", HOUR_FIELD}
    if level == "campaign":
        keys.add("campaign_id")
    rows = []
    for row in value["data"]:
        require(isinstance(row, dict) and set(row) <= keys, "insights_row_shape")
        require(row.get("account_id") == ACCOUNT and row.get("account_currency") == "USD", "row_account_scope")
        for field in ("date_start", "date_stop"):
            require(isinstance(row.get(field), str) and re.fullmatch(r"\d{4}-\d\d-\d\d", row[field]), "row_date")
        require(isinstance(row.get(HOUR_FIELD), str) and re.fullmatch(
            r"([01]\d|2[0-3]):00:00 - \1:59:59", row[HOUR_FIELD]), "row_hour")
        require(isinstance(row.get("spend"), str) and re.fullmatch(
            r"(?:0|[1-9]\d{0,13})(?:\.\d{1,6})?", row["spend"]), "row_spend")
        for field in ("clicks", "impressions", *(("campaign_id",) if level == "campaign" else ())):
            if field == "campaign_id" or field in row:
                require(isinstance(row.get(field), str) and re.fullmatch(r"(?:0|[1-9]\d{0,19})", row[field]),
                        "row_integer")
        rows.append(dict(row))
    # Paging cursors/previous links are unnecessary once EOF is established.
    return {"data": rows}


def capture(raw, expected_sha256, *, clock=now_utc, monotonic=time.monotonic, runner=run_curl):
    bound = bind_cycle(raw, expected_sha256)
    start = monotonic()
    require(bound.not_before <= clock() < bound.deadline, "cycle_not_current")
    require(clock() >= bound.window.query_close, "query_not_closed")
    remaining = bound.values["maxBytes"]
    receipts = {}
    calls = 0

    def get(label, level=None, limit=None, ceiling=None):
        nonlocal remaining, calls
        before = clock()
        left = min(MAX_SECONDS - (monotonic() - start), (bound.deadline - before).total_seconds())
        require(bound.not_before <= before < bound.deadline and left > 0, "cycle_deadline")
        require(calls < 3 and remaining > 0, "global_budget")
        if level:
            require(before >= bound.window.query_close, "query_not_closed")
        path = "/act_" + ACCOUNT + ("/insights" if level else "")
        fields = "account_id,account_currency,date_start,date_stop,spend,impressions,clicks"
        if level == "campaign":
            fields += ",campaign_id"
        params = ({"fields": META_FIELDS} if level is None else {
            "time_range": json.dumps({"since": bound.window.since, "until": bound.window.until}),
            "time_increment": "1", "breakdowns": HOUR_FIELD, "level": level, "fields": fields, "limit": str(limit),
        })
        request_seconds = min(15.0, left)
        response_limit = min(remaining, MAX_BODY_BYTES)
        command = ["curl", "--disable", "--silent", "--show-error", "--retry", "0", "--proto", "=https",
                   "--connect-timeout", str(min(5.0, request_seconds)), "--max-time", str(request_seconds),
                   "--max-filesize", str(response_limit), "--get", ROOT + path, "--write-out", "\nSTATUS:%{http_code}"]
        for key, value in params.items():
            command.extend(["--data-urlencode", key + "=" + value])
        calls += 1
        body, status = runner(command, response_limit, min(20.0, left))
        require(isinstance(body, bytes), "transport_body")
        remaining -= len(body)
        require(remaining >= 0, "global_byte_budget")
        require(len(body) <= response_limit, "response_byte_budget")
        after = clock()
        require(before <= after < bound.deadline and monotonic() - start < MAX_SECONDS, "cycle_deadline")
        require(status == 200, "provider_http_error")
        response = safe_response(strict_json(body), level, ceiling)
        require(monotonic() - start < MAX_SECONDS and clock() < bound.deadline, "cycle_deadline")
        receipts[label] = {
            "startedAt": before.isoformat(), "finishedAt": after.isoformat(), "method": "GET",
            "url": ROOT + path, "params": params, "status": status,
            "bodyBytes": len(body), "bodySha256": hashlib.sha256(body).hexdigest(),
            "pagingCredentialQueryParametersRemoved": True,
            "responseProjectedToRequestedSafeFields": True, "response": response,
        }

    get("account")
    get("account-hours", "account", 49, 48)
    get("campaign-hours", "campaign", 1001, 1000)
    require(calls == 3, "request_count")
    return {
        "receipts": receipts,
        "summary": {
            "status": "source_capture_complete", "cycleId": bound.values["cycleId"],
            "bindingSha256": bound.sha256, "date": bound.values["date"], "requests": calls,
            "bodyBytes": bound.values["maxBytes"] - remaining,
            "querySince": bound.window.since, "queryUntil": bound.window.until,
            "reportFromAt": bound.window.report_from.isoformat(), "reportUntilAt": bound.window.report_until.isoformat(),
            "sourceTimezone": "America/Los_Angeles", "reportTimezone": "America/New_York",
            "metricAcceptance": False, "registered": False, "enabled": False,
        },
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binding", required=True)
    parser.add_argument("--binding-sha256", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    made_output = False
    try:
        require(not os.path.lexists(args.output), "output_exists")
        with open(args.binding, "rb") as file:
            raw = file.read(16385)
        result = capture(raw, args.binding_sha256)
        os.mkdir(args.output, 0o700)
        made_output = True
        for name, value in {**result["receipts"], "cycle": result["summary"]}.items():
            path = os.path.join(args.output, name + ".json")
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, "w", encoding="utf8") as file:
                json.dump(value, file, indent=2, allow_nan=False)
                file.write("\n")
        print(json.dumps(result["summary"]))
        return 0
    except Exception as error:
        # Never include exception strings, provider bodies, commands or stderr.
        code = str(error) if isinstance(error, Refusal) and re.fullmatch(r"[a-z0-9_]+", str(error)) else "capture_failed"
        print(json.dumps({"status": "stopped", "stageCode": code,
                          "privatePartialOutput": made_output, "metricAcceptance": False}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
