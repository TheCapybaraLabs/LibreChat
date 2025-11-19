# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture

**Monorepo Structure:**
- `api/` - Express.js backend (CommonJS, Node.js/Bun runtime)
- `client/` - React/Vite frontend (ESM, TypeScript)
- `packages/` - Shared workspace packages:
  - `data-provider` - API client, data services (dual ESM/CJS)
  - `data-schemas` - Mongoose models/schemas
  - `api` - MCP services, utilities, endpoint logic
  - `client` - Shared React components/hooks
- `e2e/` - Playwright end-to-end tests
- `config/` - CLI scripts for user/balance management

**Key Architectural Patterns:**
- Backend: Service layer architecture with endpoint-specific services per AI provider
- Frontend: Context-based state (Recoil, Jotai) + TanStack Query for server state
- Build pipeline: Packages build first → client builds using workspace deps
- Module resolution: `~/` aliases via module-alias (backend) and Vite (frontend)
- YAML-driven configuration: `librechat.yaml` for endpoints/interface/file strategies

## Common Commands

### Development
```bash
npm run frontend:dev       # Vite dev server on :3090 (proxies to :3080)
npm run backend:dev        # Nodemon watches api/server/index.js on :3080
```

### Testing
```bash
npm run test:api          # Jest for backend
npm run test:client       # Jest for frontend
npm run e2e               # Playwright (local config)
npm run e2e:headed        # Playwright with UI
npm run e2e:a11y          # Accessibility tests
npm run e2e:debug         # Debug mode
npm run e2e:codegen       # Generate E2E test code
npm run e2e:login         # Generate auth storage state
```

### Building
```bash
npm run build:packages    # Build all 4 shared packages sequentially
npm run frontend          # Build packages + client (production)
npm run backend           # Start production server (serves static client)
```

### Linting/Formatting
```bash
npm run lint              # ESLint on all JS/JSX/TS/TSX
npm run lint:fix          # Auto-fix ESLint issues
npm run format            # Prettier on all files
```

### Single Test Execution
```bash
# Run specific test file
cd api && npx jest path/to/test.spec.js
cd client && npx jest path/to/Component.test.tsx

# Run single E2E spec
npx playwright test --config=e2e/playwright.config.local.ts e2e/specs/auth.spec.ts
```

### Bun Alternatives
```bash
npm run b:api:dev         # Bun watch mode
npm run b:client:dev      # Vite with Bun
npm run b:test:api        # Jest via Bun
npm run b:test:client     # Jest via Bun
```

### Docker
```bash
docker compose up         # Full stack: MongoDB, Meilisearch, RAG API, pgvector
npm run start:deployed    # Use deploy-compose.yml
npm run stop:deployed     # Stop deploy-compose.yml
```

### CLI Tools (User Management)
```bash
npm run create-user       # Create new user
npm run invite-user       # Send invite email
npm run ban-user          # Ban user
npm run delete-user       # Delete user
npm run reset-password    # Reset user password
npm run list-users        # List all users
npm run user-stats        # View user statistics
npm run add-balance       # Add balance to user
npm run set-balance       # Set user balance
npm run list-balances     # View user balances
npm run update-banner     # Update banner message
npm run delete-banner     # Delete banner message
npm run reset-terms       # Reset terms acceptance
```

### Configuration
```bash
npm run update            # Update LibreChat
npm run update:local      # Update local install
npm run update:docker     # Update Docker install
npm run flush-cache       # Flush Redis cache
npm run reset-meili-sync  # Reset Meilisearch sync
npm run migrate:agent-permissions        # Migrate agent permissions
npm run migrate:prompt-permissions       # Migrate prompt permissions
```

## Important Technical Details

**Workspace Dependencies:**
- Packages reference each other via `*` version (always uses workspace)
- Build order matters: data-provider → data-schemas → api → client-package
- Frontend imports from `librechat-data-provider` (not @librechat/data-provider)

**State Management:**
- Multiple React contexts in `client/src/Providers/` (15+ contexts)
- Specialized: ChatContext, AgentsContext, ArtifactContext
- TanStack Query v4 for server state with optimistic updates

**File Structure:**
- Backend routes under `api/server/routes/`
- Backend services under `api/server/services/`
- Mongoose models in `api/models/`
- Frontend components organized by feature in `client/src/components/`
- Tests co-located in `__tests__/` directories

**Testing Infrastructure:**
- Jest for unit/integration tests
- Playwright for E2E (separate configs: local, CI, a11y)
- `mongodb-memory-server` for isolated DB tests
- Storage state for auth in E2E tests
- Coverage via jest-junit

**Build Configuration:**
- Backend uses Nodemon with ignore paths in root package.json
- Client uses Vite with aggressive code-splitting (20+ vendor chunks)
- Rollup for package bundling (dual ESM/CJS outputs)
- Terser for minification
- Gzip compression for static assets

**Authentication:**
- Passport.js with strategies: OAuth2, LDAP, JWT, local
- Session management via express-session + connect-redis
- Rate limiting (express-rate-limit, rate-limit-redis)

**Database:**
- MongoDB via Mongoose (port 27017)
- Meilisearch for conversation search
- PostgreSQL with pgvector for RAG (separate Python service)
- Redis for sessions, rate limiting, caching

**AI Integrations:**
- Custom agents framework: `@librechat/agents`
- Model Context Protocol (MCP): `@modelcontextprotocol/sdk`
- LangChain tooling: `@langchain/community`
- Providers: OpenAI, Anthropic, Google, AWS Bedrock, Azure, Ollama, etc.

**Special Features:**
- PWA support via vite-plugin-pwa
- i18n via i18next (30+ languages)
- Code Artifacts: React/HTML/Mermaid in chat (Sandpack for live previews)
- File storage strategies: Local/S3/Firebase/Azure (configurable per file type)

**Environment:**
- `.env` for secrets/variables (see `.env.example`)
- `librechat.yaml` for app configuration
- Dual runtime support (Node.js and Bun)

**Non-Obvious Behaviors:**
- Backend must run from root directory (scripts check for this)
- Frontend dev server proxies API calls to backend
- TypeScript in packages/client, JSDoc-typed JS in api (gradual migration)
- LDAP users may need `MIN_PASSWORD_LENGTH=1` to bypass local validation
- Nodemon ignores: api/data/, data/, client/, admin/, packages/
