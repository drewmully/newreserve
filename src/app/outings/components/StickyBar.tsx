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
      className="fixed bottom-0 left-0 right-0 z-40 transition-all duration-500"
      style={{
        transform: visible ? "translateY(0)" : "translateY(100%)",
        opacity: visible ? 1 : 0,
      }}
    >
      <div
        className="border-t"
        style={{
          backgroundColor: "rgba(11, 26, 18, 0.9)",
          backdropFilter: "blur(12px)",
          borderColor: "rgba(255,255,255,0.08)",
        }}
      >
        <div className="max-w-[1200px] mx-auto px-6 md:px-10 py-3 flex items-center justify-between">
          <p className="text-[13px] hidden sm:block" style={{ color: "rgba(242, 237, 228, 0.8)" }}>
            Ready to build your box?{" "}
            <span style={{ color: "#7a8c7a" }}>Custom options in 24 hours.</span>
          </p>
          <button
            onClick={scrollToForm}
            className="btn-filled text-[11px] py-2.5 px-5 ml-auto sm:ml-0"
          >
            Tell Us About Your Event
          </button>
        </div>
      </div>
    </div>
  );
}
