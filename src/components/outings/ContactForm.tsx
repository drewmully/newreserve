"use client";

import { useState, type FormEvent } from "react";

export function ContactForm() {
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    eventType: "",
    guestCount: "",
    budget: "",
    message: "",
  });

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/outings/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (!res.ok) throw new Error("Submission failed");
      setSubmitted(true);
    } catch (err) {
      console.error(err);
      alert("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >
  ) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  if (submitted) {
    return (
      <div className="text-center py-16 animate-fade-in-up">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full border border-gold/30 mb-6">
          <svg
            width="30"
            height="30"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="text-gold"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h3 className="font-serif text-2xl md:text-3xl text-cream mb-3">
          We&apos;ll be in touch
        </h3>
        <p className="text-muted text-base max-w-sm mx-auto leading-relaxed">
          Expect personalized options for your event within 24 hours.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div>
          <label className="block text-[11px] uppercase tracking-[0.12em] text-muted mb-2.5">
            Name *
          </label>
          <input
            type="text"
            name="name"
            required
            value={formData.name}
            onChange={handleChange}
            placeholder="John Smith"
            className="form-input"
          />
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-[0.12em] text-muted mb-2.5">
            Email *
          </label>
          <input
            type="email"
            name="email"
            required
            value={formData.email}
            onChange={handleChange}
            placeholder="john@company.com"
            className="form-input"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div>
          <label className="block text-[11px] uppercase tracking-[0.12em] text-muted mb-2.5">
            Event Type *
          </label>
          <div className="select-wrapper">
            <select
              name="eventType"
              required
              value={formData.eventType}
              onChange={handleChange}
              className="form-input"
            >
              <option value="" disabled>
                Select type
              </option>
              <option value="corporate">Corporate Outing</option>
              <option value="charity">Charity Tournament</option>
              <option value="wedding">Wedding Golf Event</option>
              <option value="bachelor">Bachelor / Bachelorette</option>
              <option value="club">Club Championship</option>
              <option value="member-guest">Member-Guest</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-[0.12em] text-muted mb-2.5">
            Guest Count *
          </label>
          <input
            type="number"
            name="guestCount"
            required
            min="1"
            value={formData.guestCount}
            onChange={handleChange}
            placeholder="72"
            className="form-input"
          />
        </div>
      </div>

      <div>
        <label className="block text-[11px] uppercase tracking-[0.12em] text-muted mb-2.5">
          Budget *
        </label>
        <div className="select-wrapper">
          <select
            name="budget"
            required
            value={formData.budget}
            onChange={handleChange}
            className="form-input"
          >
            <option value="" disabled>
              Select budget range
            </option>
            <option value="under-50">Under $50 per box</option>
            <option value="50-85">$50 – $85 per box</option>
            <option value="85-125">$85 – $125 per box</option>
            <option value="125-plus">$125+ per box</option>
            <option value="not-sure">Not sure yet</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-[11px] uppercase tracking-[0.12em] text-muted mb-2.5">
          Anything else?{" "}
          <span className="normal-case tracking-normal text-muted/60">
            (optional)
          </span>
        </label>
        <textarea
          name="message"
          rows={3}
          value={formData.message}
          onChange={handleChange}
          placeholder="Branding details, special requests, timeline..."
          className="form-input resize-none"
        />
      </div>

      <div className="pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="btn-filled w-full sm:w-auto text-[13px] py-4 px-8 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? "Submitting..." : "Get My Custom Options"}
        </button>
        <p className="text-muted/60 text-[12px] mt-3">
          No commitment. We&apos;ll respond within 24 hours.
        </p>
      </div>
    </form>
  );
}
