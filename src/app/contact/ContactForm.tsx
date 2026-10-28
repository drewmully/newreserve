"use client";

import { useState, type FormEvent } from "react";
import { CONTACT_ISSUE_TYPES } from "@/lib/contactIssueTypes";

type Status = "idle" | "sending" | "sent" | "error";

export function ContactForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setStatus("sending");
    setError("");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          issueType: form.get("issueType"),
          orderNumber: form.get("orderNumber"),
          message: form.get("message"),
          company: form.get("company"),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Something went wrong.");
      setStatus("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setStatus("error");
    }
  }

  if (status === "sent") {
    return (
      <div className="shop-contact-done" role="status">
        <h2>Got it.</h2>
        <p>Thanks for reaching out. We reply by email, usually within one business day.</p>
      </div>
    );
  }

  return (
    <form className="shop-contact-form" onSubmit={onSubmit} noValidate={false}>
      <label>
        <span>Email</span>
        <input name="email" type="email" required autoComplete="email" placeholder="you@example.com" />
      </label>

      <div className="shop-contact-row">
        <label>
          <span>Issue type <em>optional</em></span>
          <select name="issueType" defaultValue="">
            <option value="">Choose one</option>
            {CONTACT_ISSUE_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Order number <em>optional</em></span>
          <input name="orderNumber" type="text" inputMode="text" maxLength={40} placeholder="#1234" />
        </label>
      </div>

      <label>
        <span>Note</span>
        <textarea name="message" required rows={6} maxLength={5000} placeholder="How can we help?" />
      </label>

      {/* Honeypot, hidden from people */}
      <label className="shop-contact-hp" aria-hidden="true">
        Company
        <input name="company" type="text" tabIndex={-1} autoComplete="off" />
      </label>

      {status === "error" && <p className="shop-contact-error" role="alert">{error}</p>}

      <button type="submit" disabled={status === "sending"}>
        {status === "sending" ? "Sending…" : "Send message"}
      </button>
    </form>
  );
}
