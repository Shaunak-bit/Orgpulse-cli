// db/model.js
import { getDb } from './connection.js';

// Constants
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

/* =====================================================================================
 * Repository Model
 * =================================================================================== */
export class RepoModel {
  static getCollection() {
    return getDb().collection('repos');
  }

  /** Idempotent index creation with retries */
  static async createIndexes() {
    const col = this.getCollection();
    let attempt = 0;

    while (attempt < MAX_RETRY_ATTEMPTS) {
      try {
        await col.createIndexes([
          { key: { org: 1, name: 1 }, name: 'org_name_unique', unique: true },
          { key: { org: 1, stars: -1 }, name: 'org_stars_desc' },
          { key: { pushedAt: -1 }, name: 'pushedAt_desc' },
          { key: { topics: 1 }, name: 'topics_search', sparse: true }
        ]);

        await this._applySchemaValidation();
        console.log('✓ Repo indexes and validation rules applied');
        return;
      } catch (err) {
        attempt++;
        if (attempt >= MAX_RETRY_ATTEMPTS) throw err;
        await new Promise(res => setTimeout(res, RETRY_DELAY_MS * attempt));
      }
    }
  }

  static async _applySchemaValidation() {
    try {
      const collection = this.getCollection();
      const db = collection.db;
      await db.command({
        collMod: 'repos',
        validator: {
          $jsonSchema: {
            bsonType: 'object',
            required: ['org', 'name', 'stars', 'pushedAt'],
            properties: {
              org: { bsonType: 'string' },
              name: { bsonType: 'string' },
              stars: { bsonType: 'int', minimum: 0 },
              forks: { bsonType: 'int', minimum: 0 },
              pushedAt: { bsonType: 'date' }
            }
          }
        }
      });
    } catch (err) {
      console.warn('⚠️ Repo schema validation failed, continuing without it:', err.message);
    }
  }

  static async upsert(repoDoc) {
    const filter = { org: repoDoc.org, name: repoDoc.name };
    const update = {
      $set: { ...repoDoc, updatedAt: new Date() },
      $setOnInsert: { createdAt: new Date() }
    };
    return this.getCollection().updateOne(filter, update, { upsert: true });
  }

  static async findByOrg(org, { sortBy = 'stars', limit = 10, skip = 0 } = {}) {
    const sortField = sortBy === 'issues' ? 'openIssues' : 'stars';
    return this.getCollection().find({ org }).sort({ [sortField]: -1 }).skip(skip).limit(limit).toArray();
  }

  static async updateStats(org, name, updates) {
    return this.getCollection().updateOne(
      { org, name },
      { $set: { ...updates, updatedAt: new Date() } }
    );
  }
}

/* =====================================================================================
 * Issue Model
 * =================================================================================== */
export class IssueModel {
  static getCollection() {
    return getDb().collection('issues');
  }

  static async createIndexes() {
    const col = this.getCollection();
    await col.createIndexes([
      { key: { repo: 1, number: 1 }, name: 'repo_number_unique', unique: true },
      { key: { repo: 1, state: 1 }, name: 'repo_state' },
      { key: { createdAt: -1 }, name: 'createdAt_desc' },
      { key: { labels: 1 }, name: 'labels_search', sparse: true }
    ]);
    console.log('✓ Issue indexes applied');
  }

  static async bulkUpsert(issues, batchSize = 100) {
    if (!issues?.length) return { inserted: 0, updated: 0 };
    let inserted = 0;
    let updated = 0;

    for (let i = 0; i < issues.length; i += batchSize) {
      const batch = issues.slice(i, i + batchSize);
      const ops = batch.map(issue => ({
        updateOne: { filter: { repo: issue.repo, number: issue.number }, update: { $set: issue }, upsert: true }
      }));
      const result = await this.getCollection().bulkWrite(ops);
      inserted += result.upsertedCount;
      updated += result.modifiedCount;
    }

    return { inserted, updated };
  }

  static async countOpenIssues(repo) {
    const count = await this.getCollection().countDocuments({ repo, state: 'open' });
    await this.getCollection().updateOne({ repo }, { $set: { openCount: count } }, { upsert: true });
    return count;
  }
}

/* =====================================================================================
 * Initialization
 * =================================================================================== */
export async function initializeDatabase() {
  try {
    const db = getDb();
    if (!db) throw new Error('Database connection not available');

    await db.command({ ping: 1 });
    console.log('✓ Database connection verified');

    await RepoModel.createIndexes();
    await IssueModel.createIndexes();

    console.log('🎉 Database fully initialized and ready!');
    return true;
  } catch (err) {
    console.error('❌ Database initialization failed:', err);
    throw err;
  }
}

/* =====================================================================================
 * GitHub → MongoDB mappers
 * =================================================================================== */
export function mapRepoFromGitHub(apiRepo, org) {
  return {
    org,
    name: apiRepo.name,
    description: apiRepo.description || '',
    topics: apiRepo.topics || [],
    language: apiRepo.language || '',
    stars: apiRepo.stargazers_count,
    forks: apiRepo.forks_count,
    openIssues: apiRepo.open_issues_count,
    license: apiRepo.license?.spdx_id || null,
    pushedAt: new Date(apiRepo.pushed_at),
    has_wiki: apiRepo.has_wiki,
    archived: apiRepo.archived
  };
}

export function mapIssueFromGitHub(apiIssue, repo) {
  return {
    repo,
    number: apiIssue.number,
    title: apiIssue.title,
    state: apiIssue.state,
    createdAt: new Date(apiIssue.created_at),
    updatedAt: new Date(apiIssue.updated_at),
    closedAt: apiIssue.closed_at ? new Date(apiIssue.closed_at) : null,
    labels: apiIssue.labels?.map(l => l.name) || [],
    user: apiIssue.user?.login
  };
}

/* =====================================================================================
 * Health Check
 * =================================================================================== */
export async function checkDatabaseHealth() {
  try {
    const db = getDb();
    if (!db) return false;

    await db.command({ ping: 1 });
    const reposReady = await RepoModel.getCollection().indexExists('org_name_unique');
    const issuesReady = await IssueModel.getCollection().indexExists('repo_number_unique');
    return reposReady && issuesReady;
  } catch {
    return false;
  }
}
