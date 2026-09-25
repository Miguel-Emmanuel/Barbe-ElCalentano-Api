import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^"|"$/g, "");
  }
}

const env = { ...process.env };
if (!env.DATABASE_URL && env.POSTGRES_PRISMA_URL) env.DATABASE_URL = env.POSTGRES_PRISMA_URL;
if (!env.DATABASE_URL && env.POSTGRES_URL) env.DATABASE_URL = env.POSTGRES_URL;
if (!env.DIRECT_URL) env.DIRECT_URL = env.POSTGRES_URL_NON_POOLING || env.DATABASE_URL;

if (!env.DATABASE_URL || !env.DIRECT_URL) {
  console.error("Falta DATABASE_URL (o POSTGRES_PRISMA_URL) y DIRECT_URL.");
  process.exit(1);
}

const result = spawnSync("npx", ["prisma", ...process.argv.slice(2)], {
  stdio: "inherit",
  env,
  shell: true,
});
process.exit(result.status ?? 1);
