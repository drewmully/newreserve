"use client";

import { useEffect, useState } from "react";

export function Navigation() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollTo = (id: string) => {
    setMenuOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
        scrolled
          ? "bg-background/90 backdrop-blur-md border-b border-border"
          : "bg-transparent"
      }`}
    >
      <div className="max-w-[1200px] mx-auto px-6 md:px-10 flex items-center justify-between h-[72px]">
        <a
          href="/"
          className="font-serif text-2xl tracking-tight text-cream hover:text-gold transition-colors"
        >
          mully
        </a>

        {/* Desktop */}
        <div className="hidden md:flex items-center gap-8">
          <button
            onClick={() => scrollTo("how-it-works")}
            className="text-[13px] uppercase tracking-[0.12em] text-muted hover:text-cream transition-colors"
          >
            How It Works
          </button>
          <button
            onClick={() => scrollTo("the-box")}
            className="text-[13px] uppercase tracking-[0.12em] text-muted hover:text-cream transition-colors"
          >
            The Box
          </button>
          <button
            onClick={() => scrollTo("packages")}
            className="text-[13px] uppercase tracking-[0.12em] text-muted hover:text-cream transition-colors"
          >
            Packages
          </button>
          <button
            onClick={() => scrollTo("contact")}
            className="btn-primary text-[11px] py-2.5 px-5"
          >
            <span>Get Started</span>
          </button>
        </div>

        {/* Mobile hamburger */}
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="md:hidden flex flex-col gap-1.5 p-2"
          aria-label="Toggle menu"
        >
          <span
            className={`block w-6 h-px bg-cream transition-all duration-300 ${
              menuOpen ? "rotate-45 translate-y-[3.5px]" : ""
            }`}
          />
          <span
            className={`block w-6 h-px bg-cream transition-all duration-300 ${
              menuOpen ? "opacity-0" : ""
            }`}
          />
          <span
            className={`block w-6 h-px bg-cream transition-all duration-300 ${
              menuOpen ? "-rotate-45 -translate-y-[3.5px]" : ""
            }`}
          />
        </button>
      </div>

      {/* Mobile menu */}
      <div
        className={`md:hidden overflow-hidden transition-all duration-500 ${
          menuOpen ? "max-h-[300px] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <div className="bg-background/95 backdrop-blur-md border-t border-border px-6 py-5 flex flex-col gap-3">
          {[
            ["How It Works", "how-it-works"],
            ["The Box", "the-box"],
            ["Packages", "packages"],
          ].map(([label, id]) => (
            <button
              key={id}
              onClick={() => scrollTo(id)}
              className="text-left text-[13px] uppercase tracking-[0.12em] text-muted hover:text-cream transition-colors py-2"
            >
              {label}
            </button>
          ))}
          <button
            onClick={() => scrollTo("contact")}
            className="btn-primary text-[11px] py-2.5 px-5 mt-2 w-fit"
          >
            <span>Get Started</span>
          </button>
        </div>
      </div>
    </nav>
  );
}
