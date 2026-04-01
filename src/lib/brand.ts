export const siteConfig = {
  name: "Polytheta",
  domain: "polytheta.com",
  description:
    "Members-only options basket intelligence with transparent weekly recommendations, disciplined risk framing, and performance tracking built for serious users.",
  accent: "#88b4ff",
  supportEmail: "hello@polytheta.com",
};

export const appNavigation = [
  { href: "/", label: "Home" },
  { href: "/methodology", label: "How It Works" },
  { href: "/preview", label: "Preview" },
  { href: "/about", label: "About" },
  { href: "/faq", label: "FAQ" },
  { href: "/contact", label: "Request Access" },
] as const;

export const memberNavigation = [
  { href: "/app/dashboard", label: "Dashboard" },
  { href: "/app/baskets/current", label: "Current Basket" },
  { href: "/app/baskets", label: "Archive" },
  { href: "/app/analytics", label: "Analytics" },
  { href: "/app/settings", label: "Settings" },
] as const;

export const adminNavigation = [
  { href: "/admin", label: "Admin Dashboard" },
  { href: "/admin/baskets", label: "Baskets" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/overrides", label: "Overrides" },
  { href: "/admin/sync", label: "Sync" },
] as const;
