"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMembership } from "../context/MembershipContext";

export function EmailCTA({ variant = "hero" }: { variant?: "hero" | "bottom" }) {
  const router = useRouter();
  const { setEmail } = useMembership();
  const [value, setValue] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim()) setEmail(value.trim());
    router.push("/onboarding");
  };

  if (variant === "hero") {
    return (
      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row items-stretch gap-3 max-w-md mb-5">
        <input
          type="email"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Your email"
          className="w-full sm:flex-1 h-13 px-5 rounded-xl bg-white/60 border border-taupe/30 text-obsidian placeholder:text-charcoal/35 text-base focus:border-forest/40 focus:ring-2 focus:ring-forest/10 transition-all duration-300"
        />
        <button
          type="submit"
          className="w-full sm:w-auto h-13 px-8 rounded-xl bg-forest text-bone text-sm font-medium tracking-wider uppercase hover:bg-forest-dark transition-colors duration-300 cursor-pointer whitespace-nowrap btn-press"
        >
          Unlock Access
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <input
        type="email"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Your email"
        className="w-full h-13 px-5 rounded-xl bg-bone border border-taupe/30 text-obsidian placeholder:text-taupe text-base focus:border-forest focus:ring-2 focus:ring-forest/20 transition-all duration-300"
      />
      <button
        type="submit"
        className="w-full h-13 rounded-xl bg-forest text-bone text-sm font-medium tracking-wider uppercase hover:bg-forest-dark transition-colors duration-300 cursor-pointer btn-press"
      >
        Get Started
      </button>
    </form>
  );
}
