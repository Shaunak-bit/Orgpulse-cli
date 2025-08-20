import { Octokit } from 'octokit';

class GitHubAPI {
  constructor() {
    this.octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN || undefined,
    });
    this.maxRetries = 3;
  }

  // Sleep utility
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Calculate exponential backoff delay
  calculateBackoffDelay(retryCount) {
    // Exponential backoff: 1s → 3s → 9s
    return Math.pow(3, retryCount) * 1000;
  }

  // Check if error is rate limit related
  isRateLimited(error) {
    return error.status === 403 && 
           error.response?.headers && 
           error.response.headers['x-ratelimit-remaining'] === '0';
  }

  // Check if error is retryable
  isRetryableError(error) {
    if (!error.status) return true; // Network errors are retryable
    
    const status = error.status;
    return status >= 500 || status === 502 || status === 503 || status === 504 || status === 429;
  }

  // Handle rate limiting
  async handleRateLimit(error) {
    const resetTime = error.response?.headers?.['x-ratelimit-reset'];
    if (!resetTime) {
      console.log('🚫 Rate limited but no reset time found, waiting 60s');
      await this.sleep(60000);
      return;
    }

    const resetDate = new Date(parseInt(resetTime) * 1000);
    const waitTime = resetDate.getTime() - Date.now();
    
    if (waitTime > 0) {
      console.log(`🚫 Rate limit hit! Waiting ${Math.ceil(waitTime / 1000)}s until ${resetDate.toLocaleTimeString()}`);
      await this.sleep(waitTime + 1000); // Add 1s buffer
    }
  }

  // Make request with retry logic
  async makeRequestWithRetry(requestFn, retryCount = 0) {
    try {
      return await requestFn();
    } catch (error) {
      // Handle rate limiting
      if (this.isRateLimited(error)) {
        await this.handleRateLimit(error);
        return this.makeRequestWithRetry(requestFn, retryCount);
      }
      
      // Handle other retryable errors with exponential backoff
      if (this.isRetryableError(error) && retryCount < this.maxRetries) {
        const delay = this.calculateBackoffDelay(retryCount);
        console.log(`Request failed, retrying in ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
        console.log(`Error: ${error.message}`);
        await this.sleep(delay);
        return this.makeRequestWithRetry(requestFn, retryCount + 1);
      }
      
      throw error;
    }
  }

  // Log rate limit status
  logRateLimit(headers) {
    if (headers && headers['x-ratelimit-remaining']) {
      const remaining = headers['x-ratelimit-remaining'];
      const reset = new Date(parseInt(headers['x-ratelimit-reset']) * 1000);
      console.log(`⚡ Rate limit: ${remaining} requests remaining (resets at ${reset.toLocaleTimeString()})`);
    }
  }

  // Fetch repositories with proper pagination and rate limiting
  async fetchOrgRepos(org, since = null, startPage = 1) {
    const repos = [];
    let page = startPage;
    let hasNextPage = true;
    let totalFetched = 0;

    console.log(`🚀 Starting repository fetch for ${org} from page ${startPage}`);

    while (hasNextPage) {
      console.log(`📄 Fetching repositories page ${page} for ${org}...`);

      try {
        const response = await this.makeRequestWithRetry(async () => {
          return await this.octokit.request('GET /orgs/{org}/repos', {
            org,
            per_page: 100,
            page,
            sort: 'updated',
            direction: 'desc',
            ...(since && { since })
          });
        });

        const pageRepos = response.data;
        
        if (!pageRepos || pageRepos.length === 0) {
          console.log(`✅ No more repositories found, completed at page ${page}`);
          break;
        }

        // Filter by since date if provided (client-side filtering)
        let filteredRepos = pageRepos;
        if (since) {
          const sinceDate = new Date(since);
          filteredRepos = pageRepos.filter(repo => 
            new Date(repo.pushed_at) >= sinceDate
          );
          console.log(`📅 Filtered ${pageRepos.length} repos to ${filteredRepos.length} updated since ${since}`);
        }

        repos.push(...filteredRepos);
        totalFetched += filteredRepos.length;

        // Log progress and rate limit status
        console.log(`✅ Fetched ${filteredRepos.length} repos on page ${page} (${totalFetched} total)`);
        this.logRateLimit(response.headers);

        // Check if we should continue (Octokit doesn't auto-paginate with our retry wrapper)
        hasNextPage = pageRepos.length === 100; // If we got a full page, there might be more
        page++;

        // Optional: Add small delay between pages to be nice to GitHub
        await this.sleep(100);

      } catch (error) {
        console.error(`❌ Error fetching repositories page ${page}:`, error.message);
        throw error;
      }
    }

    console.log(`🎉 Completed fetching ${totalFetched} repositories for ${org}`);
    return repos;
  }

  // Fetch issues for a specific repository
  async fetchRepoIssues(org, repo, limit = 30) {
    console.log(`    🎫 Fetching issues for ${org}/${repo}...`);

    try {
      const response = await this.makeRequestWithRetry(async () => {
        return await this.octokit.request('GET /repos/{org}/{repo}/issues', {
          org,
          repo,
          state: 'all',
          per_page: limit,
          sort: 'created',
          direction: 'desc'
        });
      });

      const issues = response.data;
      console.log(`    ✅ Fetched ${issues.length} issues for ${org}/${repo}`);
      this.logRateLimit(response.headers);
      
      return issues;

    } catch (error) {
      if (error.status === 404) {
        console.log(`    ⚠️  Issues not accessible for ${org}/${repo} (private or disabled)`);
        return [];
      } else {
        console.error(`    ❌ Error fetching issues for ${org}/${repo}:`, error.message);
        throw error;
      }
    }
  }

  // Lightweight method to just update stars/forks
  async fetchRepoStats(org, repo) {
    try {
      const response = await this.makeRequestWithRetry(async () => {
        return await this.octokit.request('GET /repos/{org}/{repo}', {
          org,
          repo
        });
      });

      return {
        stars: response.data.stargazers_count,
        forks: response.data.forks_count,
        openIssues: response.data.open_issues_count,
        pushedAt: response.data.pushed_at
      };

    } catch (error) {
      console.error(`❌ Error fetching stats for ${org}/${repo}:`, error.message);
      throw error;
    }
  }
}

// Export both class and convenience functions
export default GitHubAPI;

// Backward compatibility - keep your original function signature
export async function fetchOrgRepos(org, since = null) {
  const api = new GitHubAPI();
  return await api.fetchOrgRepos(org, since);
}