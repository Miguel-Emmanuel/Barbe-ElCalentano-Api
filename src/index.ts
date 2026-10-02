import "dotenv/config";
import { createApp } from "./app.js";
import { processDueReminders } from "./services/notifyService.js";

const app = createApp();

if (!process.env.VERCEL) {
  const port = Number(process.env.PORT ?? 4000);
  const host = process.env.HOST ?? "0.0.0.0";
  const tick = () => {
    processDueReminders().catch((error) => {
      console.error("reminders", error instanceof Error ? error.message : error);
    });
  };
  tick();
  const timer = setInterval(tick, 5 * 60 * 1000);
  timer.unref();
  app.listen(port, host, () => {
    console.log(`EL CALENTANO API listening on http://${host}:${port}`);
  });
}

export default app;
