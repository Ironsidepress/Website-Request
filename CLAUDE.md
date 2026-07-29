# Website Factory Platform Instructions

## Product Purpose

This repository contains a multi-tenant platform that collects information from small business owners and manages an agent-assisted website production process.

The platform must support client intake, file uploads, project tracking, human approvals, Figma design, GitHub-based development, automated testing, SEO/AEO review, Cloudflare preview deployments and final production deployment.

## Core Architecture Principles

1. Use a deterministic workflow orchestrator to manage project stages.
2. Agents may perform bounded tasks but may not independently control the entire project.
3. Every agent task must have defined inputs, outputs, permissions and success criteria.
4. Human approval is required before:

   * A Figma design is sent to development.
   * A production deployment occurs.
   * A domain is purchased.
   * DNS records are changed.
   * Unverified factual claims are published.
5. Agents must never push directly to the protected main branch.
6. All code changes must occur on a branch and be submitted through a pull request.
7. All agent activity must be auditable.
8. Every workflow step must be idempotent and safe to retry.
9. Do not place secrets in source code, documentation, logs or generated artifacts.
10. Do not build a custom authentication or cryptography system.

## Technology Direction

* TypeScript
* Next.js
* Cloudflare Workers
* Cloudflare D1
* Cloudflare R2
* Cloudflare Workflows
* Cloudflare Queues
* Cloudflare Sandbox
* GitHub
* Figma MCP and REST APIs
* Zod for runtime schemas
* Automated unit, integration and end-to-end testing

## Repository Standards

* Use strict TypeScript.
* Avoid `any` unless there is a documented reason.
* Validate all external input.
* Keep business logic outside UI components.
* Use shared schemas for API requests, database records, workflow events and agent outputs.
* Create database migrations for every schema change.
* Include tests with every material feature.
* Use structured logging.
* Return safe client-facing errors and preserve detailed internal errors separately.
* Maintain tenant isolation in every database query.
* Do not expose internal agent prompts or raw agent logs to clients.

## Agent Rules

Every agent must return structured output matching a versioned schema.

Every agent run must record:

* Project ID
* Agent type
* Prompt version
* Input artifact versions
* Output artifact versions
* Model
* Start time
* Completion time
* Status
* Retry count
* Token usage
* Estimated cost
* Error details

Agents may not make unsupported factual claims.

Research and content agents must maintain a source log.

Developer agents must work only from approved design and content artifacts.

Tester agents must not approve their own fixes.

SEO/AEO agents may recommend or create changes but may not deploy them.

## Development Process

Before implementing a feature:

1. Read the relevant documents in `/docs`.
2. Identify unresolved architecture decisions.
3. Produce or update an implementation plan.
4. Define acceptance criteria.
5. Implement the smallest complete vertical slice.
6. Run formatting, linting, type checking and tests.
7. Summarize changes, risks and remaining work.

## Current Priority

The initial priority is the control-plane MVP:

1. Authentication and tenant-aware accounts.
2. Client intake form with autosave.
3. File uploads to R2.
4. Project records and stage history in D1.
5. Administrative project dashboard.
6. Cloudflare Workflow with simulated stages.
7. Human approval events.
8. Client-facing project timeline.
9. Audit logging.
10. Automated tests.

Do not implement autonomous Figma generation, autonomous website coding or production domain management until the control-plane MVP and approval workflow are working.
