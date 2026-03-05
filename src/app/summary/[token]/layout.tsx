import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Inspection Summary - SewerTime Septic",
  description: "View your septic system inspection summary and report.",
};

export default function SummaryLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-svh bg-stone-50">
      {children}
    </div>
  );
}
