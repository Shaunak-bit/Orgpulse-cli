import axios from 'axios';

export async function fetchWithRateLimit(url, options = {}, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await axios.get(url, options);

      const remaining = parseInt(res.headers['x-ratelimit-remaining']);
      const resetTime = parseInt(res.headers['x-ratelimit-reset']);

      if (remaining === 0) {
        const waitMs = (resetTime * 1000 - Date.now()) + 1000;
        console.log(`⚠️  Rate limit reached. Sleeping ${Math.ceil(waitMs / 1000)}s...`);
        await new Promise(r => setTimeout(r, waitMs));
      }

      return res.data;
    } catch (err) {
      if (attempt === retries) throw err;
      const wait = Math.pow(3, attempt) * 1000; // 1s, 3s, 9s
      console.log(`Retry #${attempt + 1} after ${wait / 1000}s...`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
}
