import { codeChangeOutputSchema } from '@website-factory/schemas';

import type { AgentExecution, AgentExecutor, AgentTask } from './dispatcher';

/**
 * Per-project code repositories (ADR-0018).
 *
 * Every project's generated website lives in its own repository. The
 * developer agent NEVER pushes to a default branch: it pushes a feature
 * branch named per stage attempt and opens a pull request, exactly as the
 * project rules require of code changes. Every call here is idempotent so a
 * retried workflow step converges instead of duplicating repos, branches or
 * pull requests.
 */

export interface GitHubRepoRef {
  fullName: string;
  htmlUrl: string;
  defaultBranch: string;
}

export interface PullRequestRef {
  number: number;
  htmlUrl: string;
}

export interface GitHubClient {
  ensureRepo(name: string, description: string): Promise<GitHubRepoRef>;
  ensureBranch(fullName: string, branch: string, fromBranch: string): Promise<void>;
  putFile(
    fullName: string,
    branch: string,
    file: { path: string; content: string },
    message: string,
  ): Promise<void>;
  ensurePullRequest(
    fullName: string,
    input: { head: string; base: string; title: string; body: string },
  ): Promise<PullRequestRef>;
}

export interface GitHubRestClientConfig {
  /** Fine-grained token or GitHub App installation token (Worker secret). */
  token: string;
  /** Account that owns generated repositories. */
  owner: string;
  /** Whether `owner` is an organization (changes the repo-create endpoint). */
  ownerIsOrg?: boolean;
  /** Generated client sites are private by default. */
  makePrivate?: boolean;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/** UTF-8 safe base64 for the contents API (no Buffer in Workers). */
function toBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export class GitHubRestClient implements GitHubClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: GitHubRestClientConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private async request(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<{ status: number; json: Record<string, unknown> }> {
    const response = await this.fetchImpl(`https://api.github.com${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.config.token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'website-factory-orchestrator',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    return { status: response.status, json };
  }

  private async requireOk(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const { status, json } = await this.request(method, path, body);
    if (status >= 300) {
      throw new Error(`github ${method} ${path} failed with ${status}: ${String(json.message)}`);
    }
    return json;
  }

  async ensureRepo(name: string, description: string): Promise<GitHubRepoRef> {
    const existing = await this.request('GET', `/repos/${this.config.owner}/${name}`);
    if (existing.status === 200) {
      return {
        fullName: String(existing.json.full_name),
        htmlUrl: String(existing.json.html_url),
        defaultBranch: String(existing.json.default_branch),
      };
    }
    if (existing.status !== 404) {
      throw new Error(
        `github repo lookup failed with ${existing.status}: ${String(existing.json.message)}`,
      );
    }
    const created = await this.requireOk(
      'POST',
      this.config.ownerIsOrg ? `/orgs/${this.config.owner}/repos` : '/user/repos',
      {
        name,
        description,
        private: this.config.makePrivate ?? true,
        // auto_init gives the repo a default branch to branch from.
        auto_init: true,
      },
    );
    return {
      fullName: String(created.full_name),
      htmlUrl: String(created.html_url),
      defaultBranch: String(created.default_branch ?? 'main'),
    };
  }

  async ensureBranch(fullName: string, branch: string, fromBranch: string): Promise<void> {
    const existing = await this.request('GET', `/repos/${fullName}/git/ref/heads/${branch}`);
    if (existing.status === 200) return;
    const base = await this.requireOk('GET', `/repos/${fullName}/git/ref/heads/${fromBranch}`);
    const sha = (base.object as { sha?: unknown } | undefined)?.sha;
    if (typeof sha !== 'string') throw new Error(`github base branch ${fromBranch} has no sha`);
    const created = await this.request('POST', `/repos/${fullName}/git/refs`, {
      ref: `refs/heads/${branch}`,
      sha,
    });
    // 422 means a concurrent retry created it first — converge quietly.
    if (created.status >= 300 && created.status !== 422) {
      throw new Error(
        `github branch create failed with ${created.status}: ${String(created.json.message)}`,
      );
    }
  }

  async putFile(
    fullName: string,
    branch: string,
    file: { path: string; content: string },
    message: string,
  ): Promise<void> {
    const current = await this.request(
      'GET',
      `/repos/${fullName}/contents/${file.path}?ref=${encodeURIComponent(branch)}`,
    );
    const sha =
      current.status === 200 && typeof current.json.sha === 'string' ? current.json.sha : undefined;
    await this.requireOk('PUT', `/repos/${fullName}/contents/${file.path}`, {
      message,
      content: toBase64(file.content),
      branch,
      ...(sha ? { sha } : {}),
    });
  }

  async ensurePullRequest(
    fullName: string,
    input: { head: string; base: string; title: string; body: string },
  ): Promise<PullRequestRef> {
    const created = await this.request('POST', `/repos/${fullName}/pulls`, input);
    if (created.status < 300) {
      return { number: Number(created.json.number), htmlUrl: String(created.json.html_url) };
    }
    // Already open from a previous attempt: reuse it (replay safety).
    const open = await this.request(
      'GET',
      `/repos/${fullName}/pulls?state=open&head=${encodeURIComponent(`${this.config.owner}:${input.head}`)}`,
    );
    const first = Array.isArray(open.json)
      ? (open.json as Array<Record<string, unknown>>)[0]
      : undefined;
    if (first) return { number: Number(first.number), htmlUrl: String(first.html_url) };
    throw new Error(
      `github pull request create failed with ${created.status}: ${String(created.json.message)}`,
    );
  }
}

export interface GitHubPublishingExecutorConfig {
  /** Generates the code change (the LLM-backed developer executor). */
  inner: AgentExecutor;
  github: GitHubClient;
  /** Records the provisioned repository on the project row. */
  recordRepo?: (task: AgentTask, repo: GitHubRepoRef) => Promise<void>;
}

/** Slug fragment safe for a repository name. */
function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'site'
  );
}

export function repoNameFor(task: AgentTask, projectName?: string): string {
  return `site-${slugify(projectName ?? task.projectId)}-${task.projectId.slice(0, 8)}`;
}

/** Path layout: "/" → index.html, "/services" → services/index.html. */
export function filePathFor(sitePath: string): string {
  const trimmed = sitePath.replace(/^\/+|\/+$/g, '');
  return trimmed === '' ? 'index.html' : `${slugify(trimmed)}/index.html`;
}

/**
 * Wraps the generating executor: publishes the generated site to the
 * project's own repository on a per-attempt feature branch, opens a pull
 * request, and records the PR as the artifact's external reference. The
 * generated code is still stored as artifact content, so previews and
 * reviewers never depend on GitHub being reachable.
 */
export class GitHubPublishingExecutor implements AgentExecutor {
  constructor(private readonly config: GitHubPublishingExecutorConfig) {}

  async execute(task: AgentTask): Promise<AgentExecution> {
    const execution = await this.config.inner.execute(task);
    const parsed = codeChangeOutputSchema.safeParse(execution.content);
    if (!parsed.success) return execution;

    const repo = await this.config.github.ensureRepo(
      repoNameFor(task),
      'Website generated by Website Factory — reviewed via pull request.',
    );
    await this.config.recordRepo?.(task, repo);

    const branch = `site/attempt-${task.attempt}`;
    await this.config.github.ensureBranch(repo.fullName, branch, repo.defaultBranch);

    const message = `Generated website (attempt ${task.attempt})`;
    for (const page of parsed.data.pages) {
      await this.config.github.putFile(
        repo.fullName,
        branch,
        {
          path: filePathFor(page.path),
          content: `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${page.title}</title>\n<link rel="stylesheet" href="/styles.css">\n</head>\n<body>\n${page.bodyHtml}\n</body>\n</html>\n`,
        },
        message,
      );
    }
    await this.config.github.putFile(
      repo.fullName,
      branch,
      { path: 'styles.css', content: `${parsed.data.css}\n` },
      message,
    );

    const pr = await this.config.github.ensurePullRequest(repo.fullName, {
      head: branch,
      base: repo.defaultBranch,
      title: `Website implementation (attempt ${task.attempt})`,
      body: [
        'Generated by the Website Factory developer agent from the approved content plan, creative brief and design.',
        '',
        '### Implementation notes',
        ...parsed.data.implementationNotes.map((note) => `- ${note}`),
        '',
        'Merging is a human decision: this branch is opened for review and is never merged by an agent.',
      ].join('\n'),
    });

    return {
      ...execution,
      externalRef: {
        provider: 'github',
        repoFullName: repo.fullName,
        repoUrl: repo.htmlUrl,
        branch,
        pullRequest: pr.number,
        reviewUrl: pr.htmlUrl,
      },
    };
  }
}
