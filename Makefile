COMPOSE = docker compose -f infra/docker-compose.yml
PREVIEW_PORT ?= 8888

.PHONY: build deploy down logs ps verify check-secrets certs certs-staging preview

check-secrets:    ## Scan tracked files for leaked IPs / emails / tailnet names
	bash scripts/check-secrets.sh

certs-staging:    ## Dry-run the wildcard cert against LE staging (no rate limits)
	bash infra/acme/issue.sh staging

certs:            ## Issue/renew the real *.zoci.me wildcard cert (DNS-01 via DigitalOcean)
	bash infra/acme/issue.sh


build:            ## Build the web + api images
	$(COMPOSE) build

deploy: build     ## Build and (re)start the stack
	$(COMPOSE) up -d

down:             ## Stop the stack
	$(COMPOSE) down

logs:             ## Tail logs
	$(COMPOSE) logs -f

ps:               ## Show status
	$(COMPOSE) ps

verify:           ## Run the Playwright smoke suite against the live site
	BASE_URL=https://zoci.me npm run test:e2e

preview:          ## Serve docs/ (SVG diagrams, static previews) on the LAN; open from a laptop/phone
	@echo "Preview: http://$$(hostname -I | awk '{print $$1}'):$(PREVIEW_PORT)/  (Ctrl-C to stop)"
	@echo "Serving ONLY ./docs — never point this at the repo root (gitignored .env/certs live there)."
	python3 -m http.server $(PREVIEW_PORT) --directory docs
