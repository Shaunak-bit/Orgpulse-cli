import { Octokit } from "octokit";
import { connectToMongo, closeConnection } from "../db/connection.js";

export default function syncStarsCommand(program) {
  program
    .command("sync-stars")
    .description("Refresh stars/forks for repos you already have")
    .requiredOption("--org <org>", "GitHub organization name")
    .action(async (options) => {
      const db = await connectToMongo();
      const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
      try {
        const repos = await db.collection("repos").find({ org: options.org }).toArray();
        if (!repos.length) {
          console.log(`⚠️ No repositories found for org ${options.org}`);
          return;
        }

        console.log(`🔄 Refreshing stars/forks for ${options.org} repos...`);
        let updatedCount = 0;

        for (const repo of repos) {
          const res = await octokit.rest.repos.get({ owner: options.org, repo: repo.name });
          const { stargazers_count, forks_count } = res.data;

          await db.collection("repos").updateOne(
            { org: options.org, name: repo.name },
            { $set: { stars: stargazers_count, forks: forks_count } }
          );
          updatedCount++;
          console.log(`Updated ${repo.name}: stars ${repo.stars} → ${stargazers_count}, forks ${repo.forks} → ${forks_count}`);
        }

        console.log(`✅ Updated ${updatedCount} repositories`);
      } catch (err) {
        console.error("❌ Error syncing stars/forks:", err.message);
      } finally {
        await closeConnection();
      }
    });
}
