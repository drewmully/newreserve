"use client";

import { useEffect, useState, type FormEvent } from "react";
import SwingBoxLanding from "./SwingBoxLanding";

/**
 * Lightweight client-side password gate. Visual-only page, no real
 * secrets behind it — the password is intentionally "demo" per the
 * pitch brief. Grants access for the session via sessionStorage.
 */
const PASSWORD = "demo";
const STORAGE_KEY = "sb_gate_ok";

export default function SwingBoxGate() {
  const [ready, setReady] = useState(false);
  const [ok, setOk] = useState(false);
  const [attempt, setAttempt] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(STORAGE_KEY) === "1") setOk(true);
    } catch {
      // sessionStorage disabled — user will just re-enter each load
    }
    setReady(true);
  }, []);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (attempt.trim().toLowerCase() === PASSWORD) {
      try {
        sessionStorage.setItem(STORAGE_KEY, "1");
      } catch {
        /* noop */
      }
      setOk(true);
    } else {
      setError(true);
    }
  }

  if (!ready) return null;
  if (ok) return <SwingBoxLanding />;

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#1E3D2F",
        color: "#FAF7EF",
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        padding: "24px",
      }}
    >
      <form
        onSubmit={onSubmit}
        style={{
          width: "100%",
          maxWidth: 360,
          background: "rgba(0,0,0,0.15)",
          border: "1px solid rgba(250,247,239,0.15)",
          borderRadius: 12,
          padding: 28,
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
            fontSize: 11,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "#9FD6AE",
            marginBottom: 12,
          }}
        >
          Private preview
        </div>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 600,
            margin: "0 0 20px",
            letterSpacing: "0.01em",
          }}
        >
          The Swing Box
        </h1>
        <input
          type="password"
          autoFocus
          value={attempt}
          onChange={(e) => {
            setAttempt(e.target.value);
            if (error) setError(false);
          }}
          placeholder="Password"
          aria-label="Password"
          style={{
            width: "100%",
            padding: "12px 14px",
            fontSize: 15,
            borderRadius: 8,
            border: error
              ? "1px solid #E48273"
              : "1px solid rgba(250,247,239,0.25)",
            background: "rgba(250,247,239,0.06)",
            color: "#FAF7EF",
            outline: "none",
            marginBottom: 14,
          }}
        />
        <button
          type="submit"
          style={{
            width: "100%",
            padding: "12px 14px",
            fontSize: 14,
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            background: "#C8402E",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            cursor: "pointer",
          }}
        >
          Enter
        </button>
        {error && (
          <div
            style={{
              marginTop: 12,
              fontSize: 13,
              color: "#E48273",
            }}
          >
            Wrong password.
          </div>
        )}
      </form>
    </main>
  );
}
