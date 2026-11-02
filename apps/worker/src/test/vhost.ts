import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    rabbitmqUrl: string;
  }
}

const envFile = fileURLToPath(new URL("../../../../.env", import.meta.url));

/**
 * Vitest global setup for *.int.test.ts: creates a throwaway vhost on the RabbitMQ in
 * RABBITMQ_URL, through its management API on port 15672, hands its URL to the tests and
 * deletes it afterwards. A dev worker running on the default vhost never sees these jobs.
 */
export default async function setup(project: TestProject) {
  if (!process.env.RABBITMQ_URL && existsSync(envFile)) loadEnvFile(envFile);
  const baseUrl = process.env.RABBITMQ_URL;
  if (!baseUrl) {
    throw new Error(
      "Integration tests need RabbitMQ: run `npm run infra:up` (RABBITMQ_URL in .env)",
    );
  }

  const amqp = new URL(baseUrl);
  const user = decodeURIComponent(amqp.username);
  const password = decodeURIComponent(amqp.password);
  const api = `http://${amqp.hostname}:15672/api`;
  const authorization = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
  const vhost = encodeURIComponent(`worker_test_${Date.now()}_${process.pid}`);

  async function call(method: string, path: string, body?: unknown) {
    const response = await fetch(`${api}${path}`, {
      method,
      headers: { authorization, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
    }
  }

  await call("PUT", `/vhosts/${vhost}`);
  await call("PUT", `/permissions/${vhost}/${encodeURIComponent(user)}`, {
    configure: ".*",
    write: ".*",
    read: ".*",
  });

  amqp.pathname = `/${vhost}`;
  project.provide("rabbitmqUrl", amqp.toString());

  return async () => {
    await call("DELETE", `/vhosts/${vhost}`);
  };
}
