"use client";

import { useState } from "react";

type Status = "idle" | "submitting" | "success" | "error";

const MEMBER_OPTIONS = [
  "Under 100",
  "100–250",
  "250–500",
  "500+",
];

const RETAIL_OPTIONS = [
  "None",
  "Logo hats / merchandise only",
  "Small curated selection",
  "Other",
];

const TIER_OPTIONS = [
  "Starter (free, rev-share)",
  "Boutique ($995/mo)",
  "Atelier ($2,000/mo)",
  "Not sure yet",
];

export default function FoundingPartnerForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setErrorMessage("");

    const form = event.currentTarget;
    const fd = new FormData(form);
    const payload = Object.fromEntries(fd.entries());

    try {
      const res = await fetch("/api/simulatorclubs/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Request failed (${res.status})`);
      }

      setStatus("success");
      form.reset();
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  if (status === "success") {
    return (
      <div className="rounded-xl border border-ember/30 bg-forest-dark p-8 md:p-10 text-center">
        <p className="text-[11px] tracking-[0.28em] uppercase text-ember font-medium mb-4">
          Application Received
        </p>
        <h3 className="font-serif text-2xl md:text-3xl text-bone mb-3">
          We&apos;ll be in touch within five business days.
        </h3>
        <p className="text-sm text-bone/65 leading-relaxed max-w-md mx-auto">
          Founding partner applications are reviewed weekly. If your club is a fit,
          you&apos;ll hear from Drew directly — typically within five business days.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid md:grid-cols-2 gap-5">
        <Field name="clubName" label="Club Name" required />
        <Field name="contactName" label="Your Name & Title" required />
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        <Field name="location" label="Location (City, State)" required />
        <Field name="bays" label="Number of Simulator Bays" required type="number" min="1" />
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        <Select name="memberCount" label="Approximate Member Count" options={MEMBER_OPTIONS} required />
        <Select name="retailSetup" label="Current Retail Setup" options={RETAIL_OPTIONS} required />
      </div>

      <Select name="tierInterest" label="Which tier interests you most?" options={TIER_OPTIONS} required />

      <Field name="email" label="Email" required type="email" />

      <div>
        <label htmlFor="notes" className="block text-[11px] tracking-[0.22em] uppercase text-bone/70 font-medium mb-2">
          Anything else we should know? <span className="text-bone/35 normal-case tracking-normal">(optional)</span>
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={4}
          className="w-full rounded-xl bg-bone/8 border border-bone/15 px-4 py-3 text-bone text-sm placeholder:text-bone/30 focus:border-ember/60 focus:bg-bone/12 transition-colors duration-300"
          placeholder="Your retail goals, your timeline, anything that helps the conversation."
        />
      </div>

      {status === "error" && (
        <p className="text-sm text-ember">
          {errorMessage || "Something went wrong. Please email boutique@mymully.com directly."}
        </p>
      )}

      <div className="pt-2">
        <button
          type="submit"
          disabled={status === "submitting"}
          className="inline-flex items-center justify-center h-12 px-9 rounded-xl bg-ember text-forest-dark text-sm font-semibold tracking-wider uppercase hover:bg-ember/90 transition-colors duration-300 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {status === "submitting" ? "Sending…" : "Apply for a Founding Partnership"}
        </button>
        <p className="text-[11px] text-bone/40 mt-4 leading-relaxed">
          Applications reviewed weekly. We respond within five business days. No
          obligation until a partnership agreement is signed.
        </p>
      </div>
    </form>
  );
}

function Field({
  name,
  label,
  required,
  type = "text",
  min,
}: {
  name: string;
  label: string;
  required?: boolean;
  type?: string;
  min?: string;
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-[11px] tracking-[0.22em] uppercase text-bone/70 font-medium mb-2">
        {label}{required && <span className="text-ember ml-1">*</span>}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        min={min}
        className="w-full rounded-xl bg-bone/8 border border-bone/15 px-4 py-3 text-bone text-sm placeholder:text-bone/30 focus:border-ember/60 focus:bg-bone/12 transition-colors duration-300"
      />
    </div>
  );
}

function Select({
  name,
  label,
  options,
  required,
}: {
  name: string;
  label: string;
  options: string[];
  required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-[11px] tracking-[0.22em] uppercase text-bone/70 font-medium mb-2">
        {label}{required && <span className="text-ember ml-1">*</span>}
      </label>
      <select
        id={name}
        name={name}
        required={required}
        defaultValue=""
        className="w-full rounded-xl bg-bone/8 border border-bone/15 px-4 py-3 text-bone text-sm focus:border-ember/60 focus:bg-bone/12 transition-colors duration-300 appearance-none"
        style={{
          backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8' fill='none'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='%23F5F1E8' stroke-opacity='0.5' stroke-width='1.5'/%3E%3C/svg%3E\")",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 1rem center",
          paddingRight: "2.5rem",
        }}
      >
        <option value="" disabled className="text-charcoal">Select one…</option>
        {options.map((opt) => (
          <option key={opt} value={opt} className="text-charcoal">{opt}</option>
        ))}
      </select>
    </div>
  );
}
