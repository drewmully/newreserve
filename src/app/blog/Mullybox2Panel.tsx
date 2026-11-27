import Link from "next/link";

/**
 * Mullybox 2.0 panel for Journal and Letter posts (section.panel = "mullybox-2").
 * Keeps the Mullybox 2.0 art direction (night, gold CTA, pink and teal) inside
 * the Letter layout. Evergreen: no launch date, no odds or values.
 */
const IMG = "/newsletters/why-were-skipping-black-friday-november-2026";
const PRIZES = [
  { name: "Omega Speedmaster Dark Side of the Moon", src: `${IMG}/omega-speedmaster-dark-side-of-the-moon.jpeg` },
  { name: "Omega Seamaster Diver 42mm", src: `${IMG}/omega-seamaster-diver-42mm.jpeg` },
  { name: "Vessel Prime Staff Bag", src: `${IMG}/vessel-prime-staff-bag.jpeg` },
];

export function Mullybox2Panel() {
  return (
    <aside
      aria-label="Mullybox 2.0"
      data-testid="mullybox-2-panel"
      className="not-prose my-10 overflow-hidden rounded-2xl bg-[#16112b] px-5 py-7 text-[#f5f1e8] shadow-[0_20px_50px_rgba(12,10,28,.35)] md:px-8 md:py-9"
      style={{ backgroundImage: "radial-gradient(120% 80% at 100% 0%, rgba(255,62,165,.18), transparent 55%), radial-gradient(90% 70% at 0% 100%, rgba(34,225,208,.14), transparent 60%)" }}
    >
      <p className="m-0 text-[11px] font-bold uppercase tracking-[.24em] text-[#22e1d0]">Mullybox 2.0</p>
      <h3 className="m-0 mt-2 font-sans text-[2rem] font-extrabold italic leading-[1.05] tracking-[-.02em] text-white md:text-[2.5rem]">
        The mystery <span className="text-[#ff3ea5]">is back.</span>
      </h3>
      <p className="m-0 mt-4 font-sans text-[15px] leading-relaxed text-[#f5f1e8]/85 md:text-base">
        No subscription. Open your box live on your phone and see what you got, right there. Every open has a shot at the really high end stuff, like Breitling, Omega and Vessel.
      </p>
      <ul className="m-0 mt-6 grid list-none grid-cols-3 gap-2.5 p-0 md:gap-4">
        {PRIZES.map((p) => (
          <li key={p.name} className="m-0 p-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.src} alt={p.name} width={400} height={400} loading="lazy" className="m-0 block aspect-square w-full rounded-lg object-cover" />
            <span className="mt-2 block font-sans text-[11px] leading-snug text-[#f5f1e8]/80 md:text-xs">{p.name}</span>
          </li>
        ))}
      </ul>
      <p className="m-0 mt-4 font-sans text-[11px] leading-snug text-[#f5f1e8]/55">
        Pictured items are examples from the prize pool. What&apos;s available can change.
      </p>
      <Link
        href="/mullybox"
        data-testid="mullybox-2-panel-cta"
        className="mt-6 inline-flex min-h-12 items-center justify-center rounded-lg bg-[#ecc767] px-6 font-sans text-sm font-bold uppercase tracking-[.1em] text-[#17120a] no-underline shadow-[0_8px_24px_rgba(236,199,103,.25)] transition hover:brightness-105"
      >
        See Mullybox 2.0
      </Link>
    </aside>
  );
}
