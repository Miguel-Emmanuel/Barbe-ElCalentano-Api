import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "fs";
import os from "os";
import path from "path";

const port = Number(process.env.PG_PORT ?? 55432);
const databaseDir = path.join(process.env.LOCALAPPDATA ?? os.tmpdir(), "el-calentano-pg");

const pg = new EmbeddedPostgres({
  databaseDir,
  user: "calentano",
  password: "calentano",
  port,
  persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});

if (!existsSync(path.join(databaseDir, "PG_VERSION"))) {
  await pg.initialise();
}
await pg.start();
try {
  await pg.createDatabase("elcalentano");
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  if (!/already exists/i.test(message)) throw err;
}

console.log(`Postgres local en postgresql://calentano:calentano@127.0.0.1:${port}/elcalentano`);
setInterval(() => {}, 1 << 30);
