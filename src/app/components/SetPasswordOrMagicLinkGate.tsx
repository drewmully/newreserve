"use client";

/**
 * SetPasswordOrMagicLinkGate
 *
 * BLOCKING modal that fires on first /home visit when a user signed up via
 * passwordless EmailCTA flow (`password_set: false` in Firestore).
 *
 * Two paths:
 *  1) "Set a password now" — calls Firebase updatePassword(user, pwd) then
 *     writes `password_set: true` to Firestore. User continues to /home.
 *  2) "Email me a magic link" — calls sendOTPEmail(email). User can close
 *     the page and the link will sign them in on next visit.
 *
 * Voice: heartfelt, friendly, no em dashes, no filler, no corporate copy.
 */

import { useState } from "react";
import { updatePassword } from "firebase/auth";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { auth, db, sendOTPEmail } from "@/lib/firebase";
import { trackEvent } from "@/lib/tracking";

interface Props {
  email: string;
  onSatisfied: () => void;
}

export function SetPasswordOrMagicLinkGate({ email, onSatisfied }: Props) {
  const [mode, setMode] = useState<"choose" | "password" | "magic">("choose");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [magicSent, setMagicSent] = useState(false);

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password should be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    if (!auth?.currentUser) {
      setError("Session expired. Refresh the page and try again.");
      return;
    }
    setSubmitting(true);
    try {
      await updatePassword(auth.currentUser, password);
      if (db) {
        await updateDoc(doc(db, "users", auth.currentUser.uid), {
          password_set: true,
          auth_method: "email_password",
          updated_at: serverTimestamp(),
        });
      }
      try {
        trackEvent("password_set", { method: "first_visit_gate" });
      } catch {
        // analytics is best-effort
      }
      onSatisfied();
    } catch (err) {
      console.error("[SetPasswordGate] updatePassword failed", err);
      setError(
        err instanceof Error
          ? err.message
          : "Could not set password. Try the magic link option."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendMagicLink = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await sendOTPEmail(email);
      setMagicSent(true);
      try {
        trackEvent("magic_link_sent", { source: "first_visit_gate" });
      } catch {
        // analytics is best-effort
      }
    } catch (err) {
      console.error("[SetPasswordGate] sendOTPEmail failed", err);
      setError(
        err instanceof Error
          ? err.message
          : "Could not send the link. Try setting a password instead."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-obsidian/80 backdrop-blur-sm px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gate-title"
    >
      <div className="bg-bone rounded-2xl shadow-2xl max-w-md w-full p-8 md:p-10 animate-fade-up">
        <p className="text-[10px] tracking-[0.32em] uppercase text-sage font-medium mb-3">
          One quick step
        </p>
        <h2
          id="gate-title"
          className="font-serif text-2xl md:text-3xl text-obsidian leading-tight mb-3"
        >
          Lock in your sign-in.
        </h2>
        <p className="text-sm text-obsidian/70 leading-relaxed mb-6">
          You signed up with just your email. Pick how you want to get back in
          next time.
        </p>

        {mode === "choose" && (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setMode("password")}
              className="w-full text-left rounded-xl border border-forest/20 bg-white px-5 py-4 hover:border-forest hover:shadow-sm transition"
            >
              <div className="font-serif text-base text-obsidian mb-1">
                Set a password
              </div>
              <div className="text-xs text-obsidian/60">
                Sign in fast, anytime, with email and password.
              </div>
            </button>
            <button
              type="button"
              onClick={() => setMode("magic")}
              className="w-full text-left rounded-xl border border-forest/20 bg-white px-5 py-4 hover:border-forest hover:shadow-sm transition"
            >
              <div className="font-serif text-base text-obsidian mb-1">
                Email me a magic link
              </div>
              <div className="text-xs text-obsidian/60">
                We send a one-tap sign-in link to {email}.
              </div>
            </button>
          </div>
        )}

        {mode === "password" && (
          <form onSubmit={handleSetPassword} className="space-y-4">
            <div>
              <label
                htmlFor="gate-pwd"
                className="block text-[11px] tracking-[0.18em] uppercase text-obsidian/60 mb-1.5"
              >
                New password
              </label>
              <input
                id="gate-pwd"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
                className="w-full px-4 py-3 rounded-lg border border-forest/20 focus:border-forest focus:outline-none focus:ring-2 focus:ring-forest/20 text-obsidian"
              />
            </div>
            <div>
              <label
                htmlFor="gate-pwd-confirm"
                className="block text-[11px] tracking-[0.18em] uppercase text-obsidian/60 mb-1.5"
              >
                Confirm
              </label>
              <input
                id="gate-pwd-confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
                className="w-full px-4 py-3 rounded-lg border border-forest/20 focus:border-forest focus:outline-none focus:ring-2 focus:ring-forest/20 text-obsidian"
              />
            </div>
            {error && (
              <p className="text-xs text-ember bg-ember/10 px-3 py-2 rounded-md">
                {error}
              </p>
            )}
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setMode("choose");
                  setError(null);
                }}
                className="px-4 py-3 text-sm text-obsidian/60 hover:text-obsidian"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 px-5 py-3 rounded-lg bg-forest text-bone text-sm font-medium hover:bg-forest/90 disabled:opacity-60 transition"
              >
                {submitting ? "Saving..." : "Save password"}
              </button>
            </div>
          </form>
        )}

        {mode === "magic" && (
          <div className="space-y-4">
            {magicSent ? (
              <div className="space-y-4">
                <div className="rounded-lg bg-sage/10 px-4 py-3 text-sm text-obsidian/80">
                  Sent. Check {email} for your sign-in link. You can close this
                  page. The link signs you in next time.
                </div>
                <button
                  type="button"
                  onClick={onSatisfied}
                  className="w-full px-5 py-3 rounded-lg bg-forest text-bone text-sm font-medium hover:bg-forest/90 transition"
                >
                  Continue to home
                </button>
              </div>
            ) : (
              <>
                <p className="text-sm text-obsidian/70">
                  We'll email a one-tap sign-in link to{" "}
                  <span className="font-medium text-obsidian">{email}</span>.
                </p>
                {error && (
                  <p className="text-xs text-ember bg-ember/10 px-3 py-2 rounded-md">
                    {error}
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setMode("choose");
                      setError(null);
                    }}
                    className="px-4 py-3 text-sm text-obsidian/60 hover:text-obsidian"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={handleSendMagicLink}
                    disabled={submitting}
                    className="flex-1 px-5 py-3 rounded-lg bg-forest text-bone text-sm font-medium hover:bg-forest/90 disabled:opacity-60 transition"
                  >
                    {submitting ? "Sending..." : "Send the link"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
