import { neon } from "@netlify/neon";
import { drizzle } from "drizzle-orm/neon-http";

import { env, hasDatabase } from "@/lib/env";

import { schema } from "./schema";

export const db = hasDatabase
  ? drizzle({
      client: neon(env.databaseUrl!),
      schema,
    })
  : null;
