import type { MetadataRoute } from "next";

import { siteConfig } from "@/lib/brand";

// Web App Manifest — makes polytheta.com installable via Add to Home Screen
// on iPhone/iPad (and Android/desktop). Next serves this at
// /manifest.webmanifest and injects the <link> automatically; the
// apple-touch-icon comes from src/app/apple-icon.png by file convention.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: siteConfig.name,
    short_name: siteConfig.name,
    description: siteConfig.description,
    id: "/app/dashboard",
    start_url: "/app/dashboard",
    display: "standalone",
    background_color: "#0b1524",
    theme_color: "#0b1524",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
