import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Delivery Verification System",
  description: "Phase 0 — foundations. No features implemented yet.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
