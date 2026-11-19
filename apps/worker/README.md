# apps/worker

Runs the background jobs. Today that is one queue, `ingest`: turning a note into MCQs with
`ingestSource()` from `@repo/ingest`.

## What it consumes

| Queue    | Job (`packages/contracts`) | Published by                                           |
| -------- | -------------------------- | ------------------------------------------------------ |
| `ingest` | `ingest.requested`         | The "Generate questions" route, and this worker itself |

It sends `ingest.completed` and `ingest.failed` to the `events` exchange with routing key
`user.<owner>`. Realtime forwards them to that user's `/events` socket, and the note page shows the
result. The topology (exchanges, queues, the retry waiting room and the parking lot) lives in
`packages/messaging/src/topology.ts`.

## One click, step by step

1. The route checks the session and the note's owner, publishes
   `{ source_id, version, run: 1, requested_at }`, waits for the broker's confirm (at most 3 s,
   else 503) and answers `202 { status: "queued" }`.
2. The worker runs `ingestSource()` on the note's current `content_md`. One run asks the model about
   at most 20 passages, one call each.
3. Then `nextStep()` decides:
   - **Follow-up:** passages are still pending, the budget lasts, the run made at least one
     question, and the click has used fewer than `MAX_RUNS_PER_CLICK` (10) runs. The same job is
     published again with `run + 1`, confirmed, and only then is this one acked.
   - **Done:** otherwise. The worker counts the live questions made since `requested_at` and sends
     **one** `ingest.completed` with `items_created`, `chunks`, `chunks_pending` and
     `budget_exhausted`. Runs before the last one send nothing.

Jobs for the same source run one after another inside a worker (`keyedQueue`), so a double click
never pays the model twice for the same passages. Across several workers it is still data-safe:
`ingestSource()` stores at most one question per passage.

## When something goes wrong

| Case                              | What happens                                                                                                                                                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model or database error           | The AI SDK retries each call twice; then the job is retried after 10 s, up to 3 attempts in all. After that it is parked in `jobs.parked` and the owner gets `ingest.failed`. Questions made before the error are kept. |
| The owner's daily budget runs out | A success: what was made is kept, the event says `budget_exhausted: true`, no retry, no follow-up.                                                                                                                      |
| The note was deleted              | Acked and logged; no event.                                                                                                                                                                                             |
| The source is not a note (a PDF)  | Parked at once (`PermanentError`), and the owner gets `ingest.failed`.                                                                                                                                                  |
| The worker dies mid-run           | The unacked job comes back; nothing is duplicated, and the final count is still right.                                                                                                                                  |
| A crash loop past 5 deliveries    | RabbitMQ parks the job itself; no `ingest.failed` is sent.                                                                                                                                                              |
| A broken message                  | Parked at once; the handler never runs.                                                                                                                                                                                 |

Look at `jobs.parked` in the RabbitMQ dashboard (http://localhost:15672 locally; an SSH tunnel on
the VM). Each parked job has `x-reason` and `x-attempt` headers.

## Environment

| Variable                       | Required | Default | Notes                                                         |
| ------------------------------ | -------- | ------- | ------------------------------------------------------------- |
| `RABBITMQ_URL`                 | yes      |         | `amqp://…`                                                    |
| `DATABASE_URL`                 | yes      |         |                                                               |
| `GOOGLE_GENERATIVE_AI_API_KEY` | yes      |         | Without it the worker exits at start-up, naming the variable. |
| `LLM_DAILY_BUDGET_USD`         | no       | `0.5`   | Per student per local day, at paid-tier prices.               |
| `HEALTH_PORT`                  | no       | `4001`  | `GET /health`                                                 |

Locally these come from the root `.env` (see `.env.example`). In production `deploy/compose.prod.yml`
passes them, and `compose up` refuses to start without the key.

## Run it

```sh
npm run infra:up                          # Postgres and RabbitMQ
npm run dev --workspace @repo/worker      # tsx watch, reads ../../.env
```

Without a key the worker prints the reason and exits, while `tsx watch` keeps watching, so the
rest of `npm run dev` keeps running. For the full loop in the browser, also run the web app, and
realtime on `PORT=4100` (`NEXT_PUBLIC_REALTIME_URL=ws://localhost:4100` and `RABBITMQ_URL` in
`apps/web/.env.local`).

`npm run build` bundles the `@repo/*` packages into `dist/`; everything in `dependencies` (amqplib,
Prisma, `ai`, `@ai-sdk/google`, zod) stays external and is installed in the Docker image.

## Tests

```sh
npm run test --workspace @repo/worker              # unit: nextStep, the handlers, env
npm run test:integration --workspace @repo/worker  # RabbitMQ + Postgres
```

The integration tests make a throwaway vhost and database per run. `src/pipeline.int.test.ts` runs
the production wiring (`startIngestWorker` in `src/app.ts`) with a mock model: a short note, a
45-passage note through follow-ups, the run cap, a model that makes nothing, a worker dying mid-run,
a failing model, the budget running out, and a PDF or deleted note.
