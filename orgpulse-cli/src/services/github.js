import fetch from "node-fetch";

export async function fetchOrgReposAndIssues(db, org) {
  console.log("👉 Entered fetchOrgReposAndIssues for:", org);

  try {
    // GitHub API base
    const baseUrl = `https://api.github.com/orgs/${org}/repos?per_page=100`;
    let page = 1;
    let allRepos = [];

    while (true) {
      const url = `${baseUrl}&page=${page}`;
      console.log("📡 Fetching:", url);

      const res = await fetch(url, {
        headers: {
          "User-Agent": "OrgPulse-CLI",
          Authorization: process.env.GITHUB_TOKEN
            ? `token ${process.env.GITHUB_TOKEN}`
            : undefined,
        },
      });

      if (!res.ok) {
        throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
      }

      const repos = await res.json();
      if (repos.length === 0) break;

      // Save repos to DB
      const repoColl = db.collection("repos");
      for (const repo of repos) {
        await repoColl.updateOne(
          { id: repo.id },
          { $set: repo },
          { upsert: true }
        );
      }

      allRepos = allRepos.concat(repos);
      page++;
    }

    console.log(`✅ Done! Inserted/updated ${allRepos.length} repos`);
    return allRepos.length;
  } catch (err) {
    console.error("❌ Error in fetchOrgReposAndIssues:", err.message);
    throw err;
  }
}
