.PHONY: deploy build-local deploy-compose compose-up-servers

# 배포 대상 서버 목록 — ssh alias를 공백으로 구분한 목록.
# 인벤토리 파일이 있으면 읽어서 노드가 늘어도 이 파일을 고칠 필요가 없다.
# 파일을 만드는 주체는 호스트를 프로비저닝하는 쪽이며 여기서는 알 바 아니다.
# 없으면 단일 노드로 폴백하고, DEPLOY_SERVERS=... 로 덮어쓸 수 있다.
DEPLOY_HOSTS_FILE ?= $(CURDIR)/../../.deploy-hosts
DEPLOY_SERVERS ?= $(or $(shell cat $(DEPLOY_HOSTS_FILE) 2>/dev/null),your-frontend-server1)
DEPLOY_PATH ?= /home/ubuntu/ktb-chat-frontend
COMPOSE_FILE ?= docker-compose.yaml
FRONTEND_IMAGE ?= youngjin179/ktb-frontend:87c9841-fe-fix3
FRONTEND_ENV_FILE ?= /etc/ktb/frontend-app.env

# 로컬에서 프로덕션 빌드
build-local:
	@echo "🏗️  Building locally..."
	pnpm run build:production
	@echo "✅ Local build completed!"

deploy:
	@echo "📦 Deploying to remote servers..."
	@for server in $(DEPLOY_SERVERS); do \
		echo "→ Deploying to $$server..."; \
		ssh $$server "mkdir -p $(DEPLOY_PATH)"; \
		echo "  📁 Copying standalone build..."; \
		rsync -avz --delete --exclude='*.log' --exclude='.env*' --exclude="server.pid" --exclude='/package.json' .next/standalone/ $$server:$(DEPLOY_PATH)/; \
		echo "  📁 Copying static files..."; \
		rsync -avz --delete .next/static $$server:$(DEPLOY_PATH)/apps/frontend/.next/; \
		echo "  📁 Copying public files..."; \
		rsync -avz --delete public $$server:$(DEPLOY_PATH)/apps/frontend/; \
		echo "  📁 Copying restart script..."; \
		rsync -avz restart.sh $$server:$(DEPLOY_PATH)/; \
		echo "  🔄 Restarting server..."; \
		ssh $$server "cd $(DEPLOY_PATH) && chmod +x restart.sh && ./restart.sh"; \
		echo "✅ Deployment to $$server completed!"; \
	done
	@echo "✅ All deployments completed!"

deploy-compose:
	@echo "📦 Deploying Docker Compose file to remote servers..."
	@for server in $(DEPLOY_SERVERS); do \
		echo "→ Deploying compose file to $$server..."; \
		ssh $$server "mkdir -p $(DEPLOY_PATH)"; \
		rsync -az $(COMPOSE_FILE) $$server:$(DEPLOY_PATH)/; \
		echo "✅ $$server completed"; \
	done
	@echo "✅ Compose deployment completed!"

compose-up-servers:
	@echo "🚀 Starting frontend containers with Docker Compose..."
	@for server in $(DEPLOY_SERVERS); do \
		echo "→ Starting frontend on $$server..."; \
		ssh $$server "cd $(DEPLOY_PATH) && \
			if docker compose version >/dev/null 2>&1; then \
				sudo env FRONTEND_IMAGE='$(FRONTEND_IMAGE)' FRONTEND_ENV_FILE='$(FRONTEND_ENV_FILE)' \
					docker compose -f $(COMPOSE_FILE) up -d; \
			else \
				sudo env FRONTEND_IMAGE='$(FRONTEND_IMAGE)' FRONTEND_ENV_FILE='$(FRONTEND_ENV_FILE)' \
					docker-compose -f $(COMPOSE_FILE) up -d; \
			fi"; \
		ssh $$server "sudo docker ps --filter name=frontend-app"; \
	done
	@echo "✅ Frontend containers started!"
