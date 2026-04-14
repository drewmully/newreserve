export default function MaintenancePage() {
  return (
    <div className="min-h-screen bg-[#1a1f1a] flex flex-col items-center justify-center px-6 text-center">
      <img src="/favicon.svg" alt="Mully" className="w-12 h-12 mb-8 opacity-80" />
      <h1 className="font-serif text-3xl text-[#e8e0d0] mb-4">
        We&rsquo;ll be right back
      </h1>
      <p className="text-[#a09880] text-base max-w-sm leading-relaxed">
        Mully Reserve is undergoing scheduled maintenance. We&rsquo;ll be back
        shortly.
      </p>
    </div>
  );
}
