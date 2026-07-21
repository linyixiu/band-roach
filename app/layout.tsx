import type { Metadata, Viewport } from "next";
import "./globals.css";
import PWARegister from "./pwa-register";

export const metadata: Metadata = {
  metadataBase: new URL("https://band-roach.yixiulin24.chatgpt.site"),
  title: "Band Roach｜級數、Capo 與吉他指法工具",
  description: "輸入 1645，立即查看和弦、Capo 換算與吉他指法，也能拍照把級數覆蓋成和弦。",
  applicationName: "Band Roach",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Band Roach",
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/icon-192.png",
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    type: "website",
    locale: "zh_TW",
    title: "Band Roach",
    description: "級數、Capo、吉他指法，一查就懂。",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Band Roach 和弦級數工具" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Band Roach",
    description: "級數、Capo、吉他指法，一查就懂。",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#9fb3bf",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant">
      <body>{children}<PWARegister /></body>
    </html>
  );
}
