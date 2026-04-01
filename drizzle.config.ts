import { defineConfig } from "drizzle-kit";

const url =
  process.env.NETLIFY_DATABASE_URL ??
  process.env.DATABASE_URL ??
  process.env.NETLIFY_DATABASE_URL_UNPOOLED;

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dbCredentials: url
    ? {
        url,
      }
    : undefined,
});
