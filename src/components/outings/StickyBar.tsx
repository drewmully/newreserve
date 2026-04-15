"use client";

import { useEffect, useState } from "react";

export function StickyBar() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setVisible(window.scrollY > window.innerHeight * 0.8);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToForm = () => {
    document.getElementById("contact")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-40 transition-all duration-500 ${
        visible
          ? "translate-y-0 opacity-100"
          : "translate-y-full opacity-0"
      }`}
    >
      <div className="bg-background/90 backdrop-blur-md border-t border-border">
        <div className="max-w-[1200px] mx-auto px-6 md:px-10 py-3 flex items-center justify-between">
          <p className="text-[13px] text-cream/80 hidden sm:block">
            Ready to build your box?{" "}
            <span className="text-muted">
              Custom options in 24 hours.
            </span>
          </p>
          <button onClick={scrollToForm} className="btn-filled text-[11px] py-2.5 px-5 ml-auto sm:ml-0">
            Tell Us About Your Event
          </button>
        </div>
      </div>
    </div>
  );
}
