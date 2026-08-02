COMPOSE = docker compose -f infra/docker-compose.yml

.PHONY: build deploy down logs ps verify check-secrets certs certs-staging

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
