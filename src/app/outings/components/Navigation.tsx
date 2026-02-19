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
      style={{
        backgroundColor: scrolled ? "rgba(11, 26, 18, 0.9)" : "transparent",
        backdropFilter: scrolled ? "blur(12px)" : undefined,
        borderBottom: scrolled ? "1px solid rgba(255,255,255,0.08)" : undefined,
      }}
      className="fixed top-0 left-0 right-0 z-50 transition-all duration-500"
    >
      <div className="max-w-[1200px] mx-auto px-6 md:px-10 flex items-center justify-between h-[72px]">
        <button
          onClick={() => scrollTo("hero")}
          className="font-serif text-2xl tracking-tight transition-colors"
          style={{ color: "#f2ede4" }}
        >
          mully
        </button>

        {/* Desktop */}
        <div className="hidden md:flex items-center gap-8">
          {[
            ["How It Works", "how-it-works"],
            ["The Box", "the-box"],
            ["Packages", "packages"],
          ].map(([label, id]) => (
            <button
              key={id}
              onClick={() => scrollTo(id)}
              className="text-[13px] uppercase tracking-[0.12em] transition-colors"
              style={{ color: "#7a8c7a" }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.color = "#f2ede4")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.color = "#7a8c7a")
              }
            >
              {label}
            </button>
          ))}
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
            className="block w-6 h-px transition-all duration-300"
            style={{
              backgroundColor: "#f2ede4",
              transform: menuOpen ? "rotate(45deg) translateY(3.5px)" : undefined,
            }}
          />
          <span
            className="block w-6 h-px transition-all duration-300"
            style={{
              backgroundColor: "#f2ede4",
              opacity: menuOpen ? 0 : 1,
            }}
          />
          <span
            className="block w-6 h-px transition-all duration-300"
            style={{
              backgroundColor: "#f2ede4",
              transform: menuOpen ? "rotate(-45deg) translateY(-3.5px)" : undefined,
            }}
          />
        </button>
      </div>

      {/* Mobile menu */}
      <div
        className="md:hidden overflow-hidden transition-all duration-500"
        style={{
          maxHeight: menuOpen ? "300px" : "0",
          opacity: menuOpen ? 1 : 0,
        }}
      >
        <div
          className="px-6 py-5 flex flex-col gap-3 border-t"
          style={{
            backgroundColor: "rgba(11, 26, 18, 0.95)",
            backdropFilter: "blur(12px)",
            borderColor: "rgba(255,255,255,0.08)",
          }}
        >
          {[
            ["How It Works", "how-it-works"],
            ["The Box", "the-box"],
            ["Packages", "packages"],
          ].map(([label, id]) => (
            <button
              key={id}
              onClick={() => scrollTo(id)}
              className="text-left text-[13px] uppercase tracking-[0.12em] transition-colors py-2"
              style={{ color: "#7a8c7a" }}
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
