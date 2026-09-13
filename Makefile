.PHONY: install dev migrate test typecheck build up down logs

install:
	bun install

dev:
	bun run dev

migrate:
	bun run db:migrate

test:
	bun test

typecheck:
	bun run typecheck

build:
	bun run build

up:
	SANTINI_ADMIN_TOKEN=$${SANTINI_ADMIN_TOKEN:-local-admin-token} \
	SANTINI_CLIENT_TOKEN=$${SANTINI_CLIENT_TOKEN:-local-client-token} \
	docker compose up --build

down:
	docker compose down -v

logs:
	docker compose logs -f gateway nginx postgres
