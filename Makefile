COMPOSE = docker compose -f infra/docker-compose.yml
PREVIEW_PORT ?= 8888

# The deploy gate runs the fast unit/contract suites + a typecheck before building. `deploy` builds
# from the working tree (not git), so running that same tree through the gate first is the right
# alignment. Emergency escape hatch: `make deploy SKIP_TESTS=1` skips the gate to ship a fast fix.
GATE = test typecheck
ifdef SKIP_TESTS
GATE =
endif

.PHONY: build deploy down logs ps verify test typecheck check-secrets check-updates certs certs-staging preview

check-secrets:    ## Scan tracked files for leaked IPs / emails / tailnet names
	bash scripts/check-secrets.sh

check-updates:    ## Flag digest-pinned images that have fallen behind latest (re-pin + make deploy)
	bash scripts/check-image-updates.sh

certs-staging:    ## Dry-run the wildcard cert against LE staging (no rate limits)
	bash infra/acme/issue.sh staging

certs:            ## Issue/renew the real *.zoci.me wildcard cert (DNS-01 via DigitalOcean)
	bash infra/acme/issue.sh


build:            ## Build the web + api images
	$(COMPOSE) build

deploy: $(GATE) build  ## Gate (tests + typecheck), build, (re)start, then post-deploy smoke
	$(COMPOSE) up -d
	bash scripts/infra-smoke.sh

down:             ## Stop the stack
	$(COMPOSE) down

logs:             ## Tail logs
	$(COMPOSE) logs -f

ps:               ## Show status
	$(COMPOSE) ps

verify:           ## Run the Playwright smoke suite against the live site
	BASE_URL=https://zoci.me npm run test:e2e

test:             ## Run every component's fast unit/contract suite (the deploy gate)
	npm test

typecheck:        ## Type-only check (the unit suites run untyped via tsx; images compile with tsc)
	npm run build --workspace api
	cd app && npx tsc -b

test-%:           ## One target: api | app | shared | ha-broker | e2e | infra
	@case '$*' in \
	  ha-broker)    npm --prefix ha-broker test ;; \
	  e2e)          npm run test:e2e ;; \
	  infra)        bash scripts/infra-smoke.sh ;; \
	  api|app|shared) npm test --workspace $* ;; \
	  *)            echo "no test target '$*' (try: api, app, shared, ha-broker, e2e, infra)"; exit 2 ;; \
	esac

preview:          ## Serve docs/ (SVG diagrams, static previews) on the LAN; open from a laptop/phone
	@echo "Preview: http://$$(hostname -I | awk '{print $$1}'):$(PREVIEW_PORT)/  (Ctrl-C to stop)"
	@echo "Serving ONLY ./docs — never point this at the repo root (gitignored .env/certs live there)."
	python3 -m http.server $(PREVIEW_PORT) --directory docs
