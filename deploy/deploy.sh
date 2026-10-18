#!/usr/bin/env sh
# Runs on the VM. The deploy workflow calls it as:  IMAGE_TAG=<git sha> ./deploy.sh
set -eu

cd "$(dirname "$0")"
: "${IMAGE_TAG:?IMAGE_TAG is required}"
export IMAGE_TAG

compose() {
  docker compose -f compose.prod.yml "$@"
}

echo "==> Pulling images for $IMAGE_TAG"
compose --profile tools pull

echo "==> Starting Postgres and RabbitMQ"
compose up -d --wait postgres rabbitmq

echo "==> Applying database migrations"
compose run --rm migrate

echo "==> Starting the new version (waits for health checks)"
compose up -d --wait --remove-orphans

echo "==> Removing images unused for a week (recent ones stay for rollbacks)"
docker image prune -af --filter "until=168h"

echo "==> Deployed $IMAGE_TAG"
