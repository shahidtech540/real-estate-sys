/**
 * Worker process entry point (`ARCHITECTURE.md` §4.1, §10.4).
 *
 * Runs the reminder tick (09:00–19:30 PKT, every 30 minutes) and the 02:00 PKT
 * maintenance jobs. It is the same image as the web process, started with
 * `node dist/worker/main.js` (`ARCHITECTURE.md` §14.2), and it never serves HTTP.
 *
 * The scheduler itself is Phase 6 work (IMPLEMENTATION-PLAN.md §6.1, §6.2).
 * This entry point exists so the compose `worker` service is real from Step 8.
 */
const startedAt = new Date().toISOString();

// Structured, redacted logging arrives with `core/logging` in Phase 1
// (AGENTS.md §5.10). A single line is enough to prove the process boots.
process.stdout.write(`spm worker started at ${startedAt}\n`);
