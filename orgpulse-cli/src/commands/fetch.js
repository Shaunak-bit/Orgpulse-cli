// src/commands/fetch.js
import { Octokit } from "octokit";
import { connectToMongo, closeConnection } from "../db/connection.js";
import fs from "fs";
import path from "path";
import "dotenv/config";

const CHECKPOINT_FILE = path.join(process.cwd(), "checkpoint.json");
const CONCURRENT_REPOS = 3;   
const MAX_RETRIES = 3;


class ConcurrencyLimiter {
  constructor(limit = 5) {
    this.limit = limit;
    this.running = 0;
    this.queue = [];
  }

  async add(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({
        fn,
        resolve,
        reject,
        id: Math.random().toString(36).substr(2, 9)
      });
      this.process();
    });
  }

  async process() {
    if (this.running >= this.limit || this.queue.length === 0) return;
    this.running++;
    const { fn, resolve, reject, id } = this.queue.shift();

    console.log(`🚀 Starting task ${id} (${this.running}/${this.limit} running, ${this.queue.length} queued)`);
    try {
      const result = await fn();
      console.log(`✅ Completed task ${id}`);
      resolve(result);
    } catch (error) {
      console.error(`❌ Failed task ${id}:`, error.message);
      reject(error);
    } finally {
      this.running--;
      console.log(`📊 Task ${id} finished (${this.running}/${this.limit} running, ${this.queue.length} queued)`);
      setTimeout(() => this.process(), 100);
    }
  }

  getStatus() {
    return { running: this.running, queued: this.queue.length, limit: this.limit };
  }

  async waitForCompletion() {
    while (this.running > 0 || this.queue.length > 0) {
      await new Promise(r => setTimeout(r, 500));
    }
  }
}


class BatchProcessor {
  constructor(concurrencyLimit = 3, batchSize = 5) {
    this.limiter = new ConcurrencyLimiter(concurrencyLimit);
    this.batchSize = batchSize;
    this.results = [];
    this.errors = [];
  }

  async processItems(items, processFn, opts = {}) {
    const {
      batchDelay = 2000,
      itemDelay = 200,
      onProgress = null,
      onBatchComplete = null
    } = opts;

    console.log(`🔄 Processing ${items.length} items with ${this.limiter.limit} concurrent workers`);
    for (let i = 0; i < items.length; i += this.batchSize) {
      const batch = items.slice(i, i + this.batchSize);
      const batchNumber = Math.floor(i / this.batchSize) + 1;
      const totalBatches = Math.ceil(items.length / this.batchSize);
      console.log(`\n📦 Batch ${batchNumber}/${totalBatches}: items ${i + 1}-${Math.min(i + this.batchSize, items.length)}`);

      const batchPromises = batch.map((item, idx) =>
        this.limiter.add(async () => {
          if (idx > 0) await new Promise(r => setTimeout(r, itemDelay * idx));
          return processFn(item, i + idx);
        })
      );

      const batchResults = await Promise.allSettled(batchPromises);
      batchResults.forEach((res, idx) => {
        const item = batch[idx];
        if (res.status === "fulfilled") {
          this.results.push({ item, result: res.value });
          onProgress?.({ item, result: res.value, success: true });
        } else {
          this.errors.push({ item, error: res.reason });
          console.error(`❌ Item ${item.name || item.id || idx} failed:`, res.reason?.message);
          onProgress?.({ item, error: res.reason, success: false });
        }
      });

      onBatchComplete?.({
        batchNumber,
        totalBatches,
        batchResults,
        totalResults: this.results.length,
        totalErrors: this.errors.length
      });

      console.log(`✅ Batch ${batchNumber} complete: ${this.results.length} successes, ${this.errors.length} errors`);
      if (i + this.batchSize < items.length) {
        console.log(`⏳ Waiting ${batchDelay}ms before next batch...`);
        await new Promise(r => setTimeout(r, batchDelay));
      }
    }

    await this.limiter.waitForCompletion();
    console.log(`🎉 All batches completed: ${this.results.length} successes, ${this.errors.length} errors`);
    return {
      results: this.results,
      errors: this.errors,
      successCount: this.results.length,
      errorCount: this.errors.length
    };
  }
}


class GitHubAPIWithRetries {
  constructor() {
    this.octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN,
      retry: { doNotRetry: ["abuse"] }
    });
  }

  sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  calculateBackoffDelay(retryCount) {
    return Math.pow(3, retryCount) * 1000;
  }

  isRateLimited(error) {
    return (error.status === 403 || error.status === 429) &&
           error.response?.headers?.["x-ratelimit-remaining"] === "0";
  }

  isRetryableError(error) {
    if (!error.status) return true;
    const s = error.status;
    return s >= 500 || s === 502 || s === 503 || s === 504 || s === 429;
  }

  async handleRateLimit(error) {
    const reset = error.response?.headers?.["x-ratelimit-reset"];
    if (!reset) {
      console.log("🚫 Rate limited but no reset header, waiting 60s");
      await this.sleep(60000);
      return;
    }
    const wait = new Date(parseInt(reset) * 1000).getTime() - Date.now();
    if (wait > 0) {
      console.log(`🚫 Rate limit hit! Waiting ${Math.ceil(wait / 1000)}s`);
      await this.sleep(wait + 1000);
    }
  }

  logRateLimit(res) {
    if (res?.headers?.["x-ratelimit-remaining"]) {
      const rem = res.headers["x-ratelimit-remaining"];
      const reset = new Date(parseInt(res.headers["x-ratelimit-reset"]) * 1000);
      console.log(`⚡ Rate limit: ${rem} requests remaining (resets ${reset.toLocaleTimeString()})`);
    }
  }

  async graphqlWithRetry(query, variables, retry = 0) {
    try {
      const res = await this.octokit.graphql(query, variables);
      if (res?.rateLimit) console.log(`⚡ GraphQL rate limit: ${res.rateLimit.remaining}/${res.rateLimit.limit}`);
      return res;
    } catch (error) {
      console.error(`GraphQL request failed (attempt ${retry + 1}):`, error.message);
      if (this.isRateLimited(error)) {
        await this.handleRateLimit(error);
        return this.graphqlWithRetry(query, variables, retry);
      }
      if (this.isRetryableError(error) && retry < MAX_RETRIES) {
        const delay = this.calculateBackoffDelay(retry);
        console.log(`Retrying in ${delay}ms (attempt ${retry + 1}/${MAX_RETRIES})`);
        await this.sleep(delay);
        return this.graphqlWithRetry(query, variables, retry + 1);
      }
      throw error;
    }
  }

  async requestWithRetry(endpoint, opts = {}, retry = 0) {
    try {
      const res = await this.octokit.request(endpoint, opts);
      this.logRateLimit(res);
      return res;
    } catch (error) {
      console.error(`REST request failed (attempt ${retry + 1}):`, error.message);
      if (this.isRateLimited(error)) {
        await this.handleRateLimit(error);
        return this.requestWithRetry(endpoint, opts, retry);
      }
      if (this.isRetryableError(error) && retry < MAX_RETRIES) {
        const delay = this.calculateBackoffDelay(retry);
        console.log(`Retrying in ${delay}ms (attempt ${retry + 1}/${MAX_RETRIES})`);
        await this.sleep(delay);
        return this.requestWithRetry(endpoint, opts, retry + 1);
      }
      throw error;
    }
  }
}


function loadCheckpoint() {
  if (!fs.existsSync(CHECKPOINT_FILE)) return {};
  try {
    const cp = JSON.parse(fs.readFileSync(CHECKPOINT_FILE, "utf-8"));
    console.log(`📂 Checkpoint loaded: org=${cp.org}, repos=${cp.repos?.count || 0}`);
    return cp;
  } catch (e) {
    console.warn("⚠️  Failed to load checkpoint:", e.message);
    return {};
  }
}

function saveCheckpoint(cp) {
  try {
    const data = { ...cp, lastUpdated: new Date().toISOString(), timestamp: Date.now() };
    fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(data, null, 2));
    console.log(`💾 Checkpoint saved: org=${data.org}, repos=${data.repos?.count || 0}`);
  } catch (e) {
    console.warn("⚠️  Failed to save checkpoint:", e.message);
  }
}

async function fetchRepositories(org, db, since) {
  console.log(`\n📦 Fetching repositories for ${org}...`);
  const github = new GitHubAPIWithRetries();
  const repoCol = db.collection("repos");
  const cp = loadCheckpoint();

  let hasNextPage = true;
  let endCursor = cp.repos?.endCursor || null;
  let fetched = cp.repos?.count || 0;
  let page = 0;

  if (cp.org === org && endCursor) {
    console.log(`🔄 Resuming from cursor: ${endCursor}, ${fetched} repos already fetched`);
  }

  while (hasNextPage) {
    page++;
    console.log(`📄 Fetching repositories page ${page} for ${org}...`);

    const query = `
      query ($org: String!, $cursor: String) {
        organization(login: $org) {
          repositories(first: 100, after: $cursor, orderBy: {field: PUSHED_AT, direction: DESC}) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id name description url createdAt updatedAt pushedAt
              stargazerCount forkCount
              issues(states: [OPEN]) { totalCount }
              isPrivate isArchived isFork
              defaultBranchRef { name }
              primaryLanguage { name }
              repositoryTopics(first: 10) { nodes { topic { name } } }
              licenseInfo { name }
            }
          }
        }
        rateLimit { limit remaining resetAt }
      }
    `;

    const res = await github.graphqlWithRetry(query, { org, cursor: endCursor });
    if (!res.organization) throw new Error(`Organization '${org}' not found`);

    let repos = res.organization.repositories.nodes;
    if (since) {
      const orig = repos.length;
      repos = repos.filter(r => new Date(r.pushedAt) >= new Date(since));
      console.log(`📅 Filtered ${orig} → ${repos.length} repos (since ${since})`);
    }

    if (repos.length) {
      const bulkOps = repos.map(r => ({
        updateOne: {
          filter: { org, name: r.name },
          update: {
            $set: {
              org,
              name: r.name,
              description: r.description,
              topics: r.repositoryTopics.nodes.map(t => t.topic.name),
              language: r.primaryLanguage?.name || null,
              stars: r.stargazerCount,
              forks: r.forkCount,
              openIssues: r.issues.totalCount,
              license: r.licenseInfo?.name || null,
              pushedAt: r.pushedAt,
              isPrivate: r.isPrivate,
              isArchived: r.isArchived,
              isFork: r.isFork,
              createdAt: r.createdAt,
              updatedAt: r.updatedAt,
              defaultBranch: r.defaultBranchRef?.name
            }
          },
          upsert: true
        }
      }));
      await repoCol.bulkWrite(bulkOps);
    }

    fetched += repos.length;
    hasNextPage = res.organization.repositories.pageInfo.hasNextPage;
    endCursor = res.organization.repositories.pageInfo.endCursor;

    saveCheckpoint({ org, repos: { endCursor, count: fetched }, lastPage: page });
    console.log(`✅ Fetched ${repos.length} repos on page ${page} (${fetched} total)`);
    await github.sleep(200);
  }

  console.log(`🎉 Total repositories stored: ${fetched}`);
  return fetched;
}


async function fetchRepoIssues(github, repo, org, db, checkpoint, since) {
  const issueCol = db.collection("issues");
  const repoId = `${org}/${repo.name}`;
  console.log(`   📌 [${repo.stars}⭐] Fetching issues for: ${repoId}`);

  let hasNextPage = true;
  let endCursor = checkpoint.issues?.[repo.name]?.endCursor || null;
  let fetched = checkpoint.issues?.[repo.name]?.count || 0;
  let page = 0;
  const maxPages = 5;

  while (hasNextPage && page < maxPages) {
    page++;
    const query = `
      query ($owner: String!, $name: String!, $cursor: String) {
        repository(owner: $owner, name: $name) {
          issues(first: 30, after: $cursor, states: [OPEN, CLOSED], orderBy: {field: CREATED_AT, direction: DESC}) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id number title state createdAt updatedAt closedAt
              author { login }
              labels(first: 5) { nodes { name } }
            }
          }
        }
        rateLimit { limit remaining resetAt }
      }
    `;

    const res = await github.graphqlWithRetry(query, {
      owner: org,
      name: repo.name,
      cursor: endCursor
    });
    if (!res.repository) {
      console.log(`     ⚠️  ${repoId} not accessible`);
      break;
    }

    let issues = res.repository.issues.nodes;
    if (since) {
      const orig = issues.length;
      issues = issues.filter(i => new Date(i.createdAt) >= new Date(since));
      if (orig !== issues.length) console.log(`     📅 Filtered ${orig} → ${issues.length} issues`);
    }

    if (issues.length) {
      const bulkOps = issues.map(i => ({
        updateOne: {
          filter: { repo: repoId, number: i.number },
          update: {
            $set: {
              repo: repoId,
              number: i.number,
              title: i.title,
              state: i.state.toLowerCase(),
              createdAt: i.createdAt,
              updatedAt: i.updatedAt,
              closedAt: i.closedAt,
              author: i.author?.login || null,
              labels: i.labels.nodes.map(l => l.name)
            }
          },
          upsert: true
        }
      }));
      await issueCol.bulkWrite(bulkOps);
    }

    fetched += issues.length;
    hasNextPage = res.repository.issues.pageInfo.hasNextPage && issues.length > 0;
    endCursor = res.repository.issues.pageInfo.endCursor;

    if (page % 2 === 0 || !hasNextPage) {
      const cp = loadCheckpoint();
      saveCheckpoint({
        ...cp,
        issues: { ...cp.issues, [repo.name]: { endCursor, count: fetched } }
      });
    }
    if (issues.length === 0 || (since && issues.length < 30)) break;
    if (hasNextPage) await github.sleep(150);
  }

  if (page >= maxPages && hasNextPage) {
    console.log(`     ⚠️  Max pages (${maxPages}) reached for ${repoId}`);
  }
  console.log(`     ✅ ${fetched} issues fetched for ${repoId}`);
  return fetched;
}

async function fetchIssues(org, db, since) {
  console.log(`\n📂 Fetching issues for repos in ${org}...`);
  const github = new GitHubAPIWithRetries();
  const repoCol = db.collection("repos");
  const cp = loadCheckpoint();

  const repos = await repoCol.find({ org }).sort({ stars: -1, forks: -1 }).toArray();
  if (!repos.length) {
    console.log("⚠️  No repositories. Run fetch command first.");
    return 0;
  }
  console.log(`📊 Found ${repos.length} repositories to process`);

  const processor = new BatchProcessor(CONCURRENT_REPOS, Math.min(5, repos.length));
  let totalFetched = 0;

  const onProgress = ({ item: repo, result, success }) => {
    if (success) totalFetched += result || 0;
  };

  const onBatchComplete = ({ batchNumber, totalBatches }) => {
    const pct = Math.round((batchNumber / totalBatches) * 100);
    console.log(`\n📈 Progress: ${pct}%`);
    const current = loadCheckpoint();
    saveCheckpoint({ ...current, progress: { batchesCompleted: batchNumber, totalBatches } });
  };

  const { successCount, errorCount } = await processor.processItems(
    repos,
    async (repo) => fetchRepoIssues(github, repo, org, db, cp, since),
    { batchDelay: 3000, itemDelay: 300, onProgress, onBatchComplete }
  );

  console.log(`\n🎉 Issue fetching complete: ${successCount} repos OK, ${errorCount} failed, ${totalFetched} issues`);
  return totalFetched;
}


async function handleFetchAction(org, since) {
  try {
    console.log("👉 Fetch action started for org:", org);
    if (!process.env.MONGO_URI) throw new Error("Missing MONGO_URI in .env");
    if (!process.env.GITHUB_TOKEN) console.warn("⚠️  No GITHUB_TOKEN – low rate limits");

    const db = await connectToMongo();
    console.log("✓ Database connection verified");

    const cp = loadCheckpoint();
    if (cp.org === org && Date.now() - cp.timestamp < 3600000) {
      console.log(`🔄 Resuming previous fetch (${Math.round((Date.now() - cp.timestamp) / 60000)} min ago)`);
    }

    const repoCount = await fetchRepositories(org, db, since);
    const issueCount = await fetchIssues(org, db, since);

    if (fs.existsSync(CHECKPOINT_FILE)) fs.unlinkSync(CHECKPOINT_FILE);
    console.log(`\n🎉 Fetch completed: ${repoCount} repos, ${issueCount} issues`);
  } catch (err) {
    console.error("❌ Fetch failed:", err.message);
    console.error("💾 Checkpoint saved – rerun same command to resume");
    process.exitCode = 1;
  } finally {
    await closeConnection();
  }
}


export default function fetchCommand(program) {
  program
    .command("fetch <org>")
    .description("Fetch repositories and issues for a GitHub org")
    .option("--since <date>", "Fetch only repos/issues updated after this date (YYYY-MM-DD)")
    .action(async (org, opts) => {
      await handleFetchAction(org, opts.since);
    });
}