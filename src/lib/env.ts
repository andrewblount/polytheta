const optional = (value: string | undefined | null) =>
  value && value.length > 0 ? value : undefined;

export const env = {
  appUrl:
    optional(process.env.NEXT_PUBLIC_APP_URL) ??
    optional(process.env.URL) ??
    "http://localhost:3000",
  databaseUrl:
    optional(process.env.NETLIFY_DATABASE_URL) ??
    optional(process.env.DATABASE_URL),
  sessionSecret: optional(process.env.SESSION_SECRET),
  syncSecret: optional(process.env.INTERNAL_SYNC_TOKEN),
  accessRequestNotifyEmail:
    optional(process.env.ACCESS_REQUEST_NOTIFY_EMAIL) ?? "ablount@bluecielo.com",
  sendGridApiKey: optional(process.env.SENDGRID_API_KEY),
  sendGridFromEmail:
    optional(process.env.SENDGRID_FROM_EMAIL) ??
    optional(process.env.ACCESS_REQUEST_NOTIFY_EMAIL) ??
    "ablount@bluecielo.com",
  demoAdminEmail: optional(process.env.DEMO_ADMIN_EMAIL),
  demoMemberEmail: optional(process.env.DEMO_MEMBER_EMAIL),
  useDemoData: process.env.POLYTHETA_DEMO_MODE === "true",
  demoRole:
    process.env.POLYTHETA_DEMO_ROLE === "admin" ||
    process.env.POLYTHETA_DEMO_ROLE === "member"
      ? process.env.POLYTHETA_DEMO_ROLE
      : undefined,
};

export const hasDatabase = Boolean(env.databaseUrl);
