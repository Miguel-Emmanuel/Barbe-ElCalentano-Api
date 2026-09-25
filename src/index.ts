import "dotenv/config";
import { createApp } from "./app.js";

const app = createApp();

if (!process.env.VERCEL) {
  const port = Number(process.env.PORT ?? 4000);
  const host = process.env.HOST ?? "0.0.0.0";
  app.listen(port, host, () => {
    console.log(`EL CALENTANO API listening on http://${host}:${port}`);
  });
}

export default app;
