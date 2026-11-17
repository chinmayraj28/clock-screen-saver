import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { site } from "./site";
import "./globals.css";

const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: `${site.name} · ${site.tagline}`,
  description: site.description,
  applicationName: site.name,
  keywords: ["desk clock", "full screen clock", "always-on display", "screensaver clock", "weather clock", "kiosk clock", "minimal clock"],
  authors: [{ name: "Chinmay Raj", url: "https://github.com/chinmayraj28" }],
  creator: "Chinmay Raj",
  category: "productivity",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: site.name,
    title: site.name,
    description: site.tagline,
    locale: "en",
  },
  twitter: { card: "summary_large_image", title: site.name, description: site.tagline },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: site.name },
  formatDetection: { telephone: false, date: false, address: false },
};

export const viewport: Viewport = { themeColor: "#0a0a0a", colorScheme: "dark" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geist.variable} h-full antialiased`}>
      <body className="h-full font-sans">{children}</body>
    </html>
  );
}
