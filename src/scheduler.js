const cron = require('node-cron');
const { syncAll } = require('./sync');

let task = null;

/**
 * Build a cron expression from an interval in minutes.
 * Examples: 15 → "* /15 * * * *", 60 → "0 * * * *", 120 → "0 * /2 * * *"
 * (spaces removed from the comments to avoid confusion with actual cron syntax)
 */
function minutesToCron(minutes) {
  const m = Math.max(1, Math.min(minutes, 1440));
  if (m < 60)  return `*/${m} * * * *`;
  if (m === 60) return `0 * * * *`;
  const hours = Math.round(m / 60);
  return `0 */${hours} * * *`;
}

function startScheduler() {
  const intervalMinutes = parseInt(process.env.SYNC_INTERVAL_MINUTES ?? '60', 10);
  const expression = minutesToCron(intervalMinutes);

  console.log(`[Scheduler] Sync every ${intervalMinutes} min  (cron: "${expression}")`);

  task = cron.schedule(expression, async () => {
    console.log(`\n[Scheduler] Tick — ${new Date().toISOString()}`);
    try {
      await syncAll();
    } catch (err) {
      console.error('[Scheduler] Unhandled sync error:', err);
    }
  });

  // Run an initial sync shortly after startup so the server is responsive first
  setTimeout(async () => {
    console.log('[Scheduler] Running initial sync…');
    try {
      await syncAll();
    } catch (err) {
      console.error('[Scheduler] Initial sync error:', err);
    }
  }, 5_000);
}

function stopScheduler() {
  task?.stop();
  task = null;
}

module.exports = { startScheduler, stopScheduler };
