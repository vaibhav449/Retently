import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Study Workspace",
  description: "Notes and PDFs that turn into a personalised revision schedule.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
