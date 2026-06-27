-include ../.env

COMPOSE ?= docker-compose
SERVICE ?= redash-mcp
CONTAINER_NAME ?= redash-mcp
HOST_PORT ?= 5001
NETWORK ?= redash_mcp_default
PROJECT_DIR ?= $(abspath ..)
COMPOSE_FILE ?= $(abspath docker-compose.yaml)

REMOTE_HOST ?= rakagent
REMOTE_DIR ?= /opt/ai/redash-mcp
REMOTE_MAKE ?= make
REMOTE_GOALS := $(wordlist 2,$(words $(MAKECMDGOALS)),$(MAKECMDGOALS))
REMOTE_MODE := $(filter remote,$(firstword $(MAKECMDGOALS)))
REMOTE_SYNC_GOALS := build up-build
REMOTE_NEEDS_SYNC := $(filter $(REMOTE_SYNC_GOALS),$(REMOTE_GOALS))
REMOTE_TTY_GOALS := shell
REMOTE_SSH_FLAGS := $(if $(filter $(REMOTE_TTY_GOALS),$(REMOTE_GOALS)),-t,)

COMPOSE_RUN = $(COMPOSE) --project-directory "$(PROJECT_DIR)" -f "$(COMPOSE_FILE)"

.PHONY: init build up-build deploy up down stop restart logs ps shell clean-containers \
	remote-sync remote

remote-sync:
	@echo "Syncing code to $(REMOTE_HOST):$(REMOTE_DIR)"
	@test -d "$(PROJECT_DIR)" || (echo "Missing PROJECT_DIR=$(PROJECT_DIR)" && exit 1)
	@ssh "$(REMOTE_HOST)" "mkdir -p '$(REMOTE_DIR)'"
	@rsync -az --delete \
		--exclude '.git/' \
		--exclude 'node_modules/' \
		--exclude 'dist/' \
		--exclude '.env' \
		--exclude '*.log' \
		--exclude '.DS_Store' \
		"$(PROJECT_DIR)/" "$(REMOTE_HOST):$(REMOTE_DIR)/"
	@echo "Synced."

remote: $(if $(REMOTE_NEEDS_SYNC),remote-sync)
	@if [ -z "$(REMOTE_GOALS)" ]; then \
		echo "Usage: make remote <target>"; \
		echo "Examples: make remote up-build | make remote logs | make remote ps"; \
	else \
		echo "Running remote make $(REMOTE_GOALS) on $(REMOTE_HOST)"; \
		ssh $(REMOTE_SSH_FLAGS) "$(REMOTE_HOST)" "set -e; cd '$(REMOTE_DIR)/frank'; $(REMOTE_MAKE) $(REMOTE_GOALS)"; \
	fi

ifeq ($(REMOTE_MODE),remote)
ifneq ($(REMOTE_GOALS),)
$(REMOTE_GOALS):
	@:
endif
else
init:
	@docker network inspect "$(NETWORK)" >/dev/null 2>&1 || docker network create "$(NETWORK)" >/dev/null

build:
	$(COMPOSE_RUN) build

clean-containers:
	@echo "Removing old containers if present"
	@if docker ps -aq --filter "name=^/$(CONTAINER_NAME)$$" | grep -q .; then \
		echo "Removing container $(CONTAINER_NAME)"; \
		docker rm -f "$(CONTAINER_NAME)" >/dev/null; \
	fi
	@containers="$$(docker ps -q --filter "publish=$(HOST_PORT)")"; \
	if [ -n "$${containers}" ]; then \
		echo "Removing containers publishing host port $(HOST_PORT)"; \
		docker rm -f $${containers} >/dev/null; \
	fi

up-build: init clean-containers
	$(COMPOSE_RUN) up -d --build

deploy: up-build

up: clean-containers
	$(COMPOSE_RUN) up -d

down:
	$(COMPOSE_RUN) down

stop:
	$(COMPOSE_RUN) stop

restart:
	$(COMPOSE_RUN) restart $(SERVICE)

logs:
	$(COMPOSE_RUN) logs -f --tail=100 $(SERVICE)

ps:
	$(COMPOSE_RUN) ps

shell:
	$(COMPOSE_RUN) exec $(SERVICE) /bin/sh
endif
