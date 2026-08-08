import type { Metadata } from "next";
import { Instrument_Serif, Public_Sans } from "next/font/google";

import { siteConfig } from "@/lib/brand";

import { ThemeProvider } from "@/components/providers/theme-provider";

import "./globals.css";

const publicSans = Public_Sans({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: {
    default: `${siteConfig.name} | Members-only options intelligence`,
    template: `%s | ${siteConfig.name}`,
  },
  description: siteConfig.description,
  metadataBase: new URL(siteConfig.domain.startsWith("http") ? siteConfig.domain : `https://${siteConfig.domain}`),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      data-scroll-behavior="smooth"
      className={`${publicSans.variable} ${instrumentSerif.variable} dark h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
