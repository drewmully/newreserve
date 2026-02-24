"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMembership } from "../context/MembershipContext";

/* ═══════════════════════════════════════════
   LOGIN PAGE
   ═══════════════════════════════════════════ */

export default function LoginPage() {
  const router = useRouter();
  const { signIn, setEmail, setUsername } = useMembership();

  const [mode, setMode] = useState<"login" | "signup">("login");
  const [emailValue, setEmailValue] = useState("");
  const [passwordValue, setPasswordValue] = useState("");
  const [nameValue, setNameValue] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const canSubmit = mode === "login"
    ? emailValue.trim() && passwordValue.trim()
    : emailValue.trim() && passwordValue.trim() && nameValue.trim();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);

    // Simulate auth
    setTimeout(() => {
      setEmail(emailValue);
      if (mode === "signup") setUsername(nameValue);
      signIn();
      router.push("/dashboard");
    }, 600);
  }

  return (
    <div className="min-h-screen bg-bone flex flex-col">
      {/* ─── HEADER ─── */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-bone/90 backdrop-blur-md border-b border-taupe/15">
        <div className="max-w-7xl mx-auto px-5 md:px-12 flex items-center justify-between h-14">
          <Link href="/" className="flex items-center gap-2 text-forest">
            <svg viewBox="0 0 1002 540" fill="currentColor" className="h-4 w-auto" aria-hidden="true"><path d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z" fillRule="evenodd" /></svg>
            <span className="font-serif text-xl font-bold tracking-wide">mully.</span>
          </Link>
        </div>
      </header>

      {/* ─── MAIN ─── */}
      <main className="flex-1 flex items-center justify-center pt-14 px-5 py-12">
        <div className="w-full max-w-sm">
          {/* Heading */}
          <div className="text-center mb-8">
            <div className="w-12 h-12 rounded-2xl bg-forest/8 flex items-center justify-center mx-auto mb-4">
              <svg viewBox="0 0 1002 540" fill="currentColor" className="h-5 w-auto text-forest" aria-hidden="true"><path d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z" fillRule="evenodd" /></svg>
            </div>
            <h1 className="font-serif text-2xl text-obsidian mb-1">
              {mode === "login" ? "Welcome back" : "Create your account"}
            </h1>
            <p className="text-sm text-charcoal/45">
              {mode === "login"
                ? "Sign in to your Mully Reserve account."
                : "Join Mully Reserve \u2014 it\u2019s free to start."}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "signup" && (
              <div>
                <label className="block text-[11px] tracking-wide uppercase text-charcoal/45 font-medium mb-1.5">
                  Full name
                </label>
                <input
                  type="text"
                  value={nameValue}
                  onChange={(e) => setNameValue(e.target.value)}
                  placeholder="Your name"
                  autoComplete="name"
                  className="w-full h-11 px-4 rounded-xl bg-cream border border-taupe/20 text-sm text-obsidian placeholder:text-charcoal/25 focus:border-forest/40 focus:ring-2 focus:ring-forest/10 transition-all duration-300"
                />
              </div>
            )}

            <div>
              <label className="block text-[11px] tracking-wide uppercase text-charcoal/45 font-medium mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={emailValue}
                onChange={(e) => setEmailValue(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                className="w-full h-11 px-4 rounded-xl bg-cream border border-taupe/20 text-sm text-obsidian placeholder:text-charcoal/25 focus:border-forest/40 focus:ring-2 focus:ring-forest/10 transition-all duration-300"
              />
            </div>

            <div>
              <label className="block text-[11px] tracking-wide uppercase text-charcoal/45 font-medium mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={passwordValue}
                  onChange={(e) => setPasswordValue(e.target.value)}
                  placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  className="w-full h-11 px-4 pr-11 rounded-xl bg-cream border border-taupe/20 text-sm text-obsidian placeholder:text-charcoal/25 focus:border-forest/40 focus:ring-2 focus:ring-forest/10 transition-all duration-300"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-charcoal/30 hover:text-charcoal/55 transition-colors duration-300 cursor-pointer"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                    </svg>
                  ) : (
                    <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  )}
                </button>
              </div>
              {mode === "login" && (
                <div className="mt-2 text-right">
                  <button type="button" className="text-xs text-forest/60 hover:text-forest transition-colors duration-300 cursor-pointer">
                    Forgot password?
                  </button>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={!canSubmit || loading}
              className={`w-full h-11 rounded-xl text-sm font-medium tracking-wider uppercase transition-all duration-300 btn-press cursor-pointer ${
                canSubmit && !loading
                  ? "bg-forest text-bone hover:bg-forest-dark"
                  : "bg-taupe/20 text-charcoal/25 cursor-not-allowed"
              }`}
            >
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-bone/30 border-t-bone rounded-full animate-spin" />
                  {mode === "login" ? "Signing in\u2026" : "Creating account\u2026"}
                </span>
              ) : (
                mode === "login" ? "Sign In" : "Create Account"
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px bg-taupe/15" />
            <span className="text-[10px] tracking-wider uppercase text-charcoal/25">or</span>
            <div className="flex-1 h-px bg-taupe/15" />
          </div>

          {/* Toggle mode */}
          <p className="text-center text-sm text-charcoal/45">
            {mode === "login" ? (
              <>
                New to Mully?{" "}
                <button
                  onClick={() => setMode("signup")}
                  className="text-forest font-medium hover:text-forest-dark transition-colors duration-300 cursor-pointer"
                >
                  Create an account
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button
                  onClick={() => setMode("login")}
                  className="text-forest font-medium hover:text-forest-dark transition-colors duration-300 cursor-pointer"
                >
                  Sign in
                </button>
              </>
            )}
          </p>

          {/* Terms */}
          <p className="text-center text-[10px] text-charcoal/25 leading-relaxed mt-6">
            By continuing, you agree to our{" "}
            <Link href="/policies/terms" className="underline underline-offset-2 hover:text-charcoal/40 transition-colors">Terms of Service</Link>
            {" "}and{" "}
            <Link href="/policies/privacy" className="underline underline-offset-2 hover:text-charcoal/40 transition-colors">Privacy Policy</Link>.
          </p>
        </div>
      </main>
    </div>
  );
}
