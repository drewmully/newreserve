import "./outings.css";

export default function OutingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="outings-root grain-overlay">
      {children}
    </div>
  );
}
