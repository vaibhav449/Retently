import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createDb } from "@repo/db";
import { DEFAULT_SYNTH } from "./config";
import { deleteSyntheticUsers } from "./reset";
import { checkDemoAllowed, checkTarget, UnsafeTargetError } from "./safety";
import { seedCohort } from "./seed";

const USAGE = `Usage: npm run db:seed -- [options]

Replaces the synthetic cohort (users @synthetic.invalid) with a freshly simulated one.

  --students <n>     students to simulate (default ${DEFAULT_SYNTH.cohort.students})
  --days <n>         days of history before the end (default ${DEFAULT_SYNTH.cohort.days})
  --seed <text>      cohort seed (default "${DEFAULT_SYNTH.cohort.seed}")
  --end <iso>        the simulated "now" (default: the current time)
  --quick            ${DEFAULT_SYNTH.quick.students} students, ${DEFAULT_SYNTH.quick.days} days: what tests and CI use
  --reset            only delete the synthetic cohort, then stop
  --truth <path>     where to write the truth sidecar (default eval/out/truth-<seed>.jsonl)
  --no-demo          do not create the demo sign-in (required in production)
  --allow-remote     seed a database that is not on this machine
  --help             this text
`;

/** Exit codes: 0 done, 1 failed while seeding, 2 refused before writing anything. */
function refuse(message: string): never {
  console.error(`db:seed: ${message}`);
  process.exit(2);
}

let args: ReturnType<typeof parse>;
function parse() {
  return parseArgs({
    options: {
      students: { type: "string" },
      days: { type: "string" },
      seed: { type: "string" },
      end: { type: "string" },
      quick: { type: "boolean", default: false },
      reset: { type: "boolean", default: false },
      truth: { type: "string" },
      "no-demo": { type: "boolean", default: false },
      "allow-remote": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    strict: true,
  }).values;
}
try {
  args = parse();
} catch (error) {
  refuse(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
}
if (args.help) {
  console.log(USAGE);
  process.exit(0);
}

function count(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) refuse(`--${name} must be a positive integer`);
  return n;
}

const preset = args.quick ? DEFAULT_SYNTH.quick : DEFAULT_SYNTH.cohort;
const students = count(args.students, preset.students, "students");
const days = count(args.days, preset.days, "days");
const seed = args.seed ?? DEFAULT_SYNTH.cohort.seed;
// The one place the wall clock is read (REQ §1): everything below gets `end` passed in.
const end = args.end === undefined ? new Date() : new Date(args.end);
if (Number.isNaN(end.getTime())) refuse(`--end "${args.end}" is not a date`);
const demo = !args["no-demo"];

const envFile = fileURLToPath(new URL("../../.env", import.meta.url));
if (!process.env.DATABASE_URL && existsSync(envFile)) loadEnvFile(envFile);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) refuse("DATABASE_URL is not set: run `npm run infra:up` and check the root .env");

// Printed first, before any connection (REQ §4).
try {
  const target = checkTarget(databaseUrl, { allowRemote: args["allow-remote"] });
  console.log(`Target database: ${target.host}:${target.port}/${target.database}`);
  if (!args.reset) checkDemoAllowed(process.env, demo);
} catch (error) {
  if (error instanceof UnsafeTargetError) refuse(error.message);
  throw error;
}

const truthPath =
  args.truth ??
  fileURLToPath(new URL(`../out/truth-${seed.replace(/[^\w.-]+/g, "_")}.jsonl`, import.meta.url));

const { db, close } = createDb(databaseUrl);
try {
  if (args.reset) {
    console.log(`Removed ${await deleteSyntheticUsers(db)} synthetic users.`);
  } else {
    console.log(
      `Seeding ${students} synthetic students over ${days} days up to ${end.toISOString()} (seed "${seed}").`,
    );
    const started = Date.now();
    const summary = await seedCohort({
      db,
      seed,
      students,
      days,
      end,
      demo,
      truthPath,
      log: (line) => console.log(`  ${line}`),
    });
    console.log(
      `Done in ${((Date.now() - started) / 1000).toFixed(1)} s: ${summary.reviews} reviews, ` +
        `${summary.sessions} sessions, ${summary.exams} exams, ${summary.dates[0]} to ${summary.endDate}.`,
    );
    console.log(`Truth sidecar: ${truthPath}`);
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await close();
}
