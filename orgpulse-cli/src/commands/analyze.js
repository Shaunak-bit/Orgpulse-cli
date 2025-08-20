import axios from "axios";
import fs from "fs";
import { Table } from "console-table-printer";

export default function analyzeCommand(program) {
  program
    .command("analyze <org>")
    .description("Analyze an organization's repos (totals, averages, languages, top repos)")
    .option("--format <type>", "Export format: json | csv | md")
    .option("--output <file>", "File to save the output")
    .action(async (org, options) => {
      console.log(`🔍 Analyzing organization: ${org}`);

      const url = `https://api.github.com/orgs/${org}/repos?per_page=100`;
      const res = await axios.get(url);
      const repos = res.data.map((repo) => ({
        name: repo.name,
        stars: repo.stargazers_count,
        forks: repo.forks_count,
        language: repo.language || "Unknown",
      }));

      if (repos.length === 0) {
        console.log("⚠️ No repos found.");
        return;
      }

      // --- Aggregates ---
      const totalRepos = repos.length;
      const totalStars = repos.reduce((sum, r) => sum + r.stars, 0);
      const totalForks = repos.reduce((sum, r) => sum + r.forks, 0);
      const avgStars = Math.round(totalStars / totalRepos);
      const avgForks = Math.round(totalForks / totalRepos);

      // --- Language breakdown ---
      const langCount = {};
      repos.forEach((r) => {
        langCount[r.language] = (langCount[r.language] || 0) + 1;
      });

      // --- Top repos ---
      const topStarred = [...repos].sort((a, b) => b.stars - a.stars)[0];
      const topForked = [...repos].sort((a, b) => b.forks - a.forks)[0];

      // --- Result object ---
      const result = {
        org,
        summary: {
          totalRepos,
          totalStars,
          totalForks,
          avgStars,
          avgForks,
        },
        languageBreakdown: langCount,
        topRepos: {
          byStars: topStarred,
          byForks: topForked,
        },
      };

      // --- Export if needed ---
      if (options.format) {
        if (!options.output) {
          console.log("⚠️ Please provide --output <file> to save the export.");
          return;
        }

        if (options.format === "json") {
          fs.writeFileSync(options.output, JSON.stringify(result, null, 2));
          console.log(`✅ Analysis exported to ${options.output}`);
          return;
        }

        if (options.format === "csv") {
          const csvData = [
            ["Repo", "Stars", "Forks", "Language"],
            ...repos.map((r) => [r.name, r.stars, r.forks, r.language]),
          ]
            .map((row) => row.join(","))
            .join("\n");

          fs.writeFileSync(options.output, csvData);
          console.log(`✅ Analysis exported to ${options.output}`);
          return;
        }

        if (options.format === "md") {
          let md = `# 📊 GitHub Analysis: ${org}\n\n`;
          md += `## Summary\n`;
          md += `- Total Repos: **${totalRepos}**\n`;
          md += `- Total Stars: **${totalStars}**\n`;
          md += `- Total Forks: **${totalForks}**\n`;
          md += `- Avg Stars per Repo: **${avgStars}**\n`;
          md += `- Avg Forks per Repo: **${avgForks}**\n\n`;

          md += `## 🌐 Language Breakdown\n`;
          md += `| Language | Repo Count |\n`;
          md += `|----------|------------|\n`;
          Object.entries(langCount).forEach(([lang, count]) => {
            md += `| ${lang} | ${count} |\n`;
          });

          md += `\n## ⭐ Top Repos\n`;
          md += `| Repo | Stars | Forks | Language |\n`;
          md += `|------|-------|-------|----------|\n`;
          md += `| ${topStarred.name} | ${topStarred.stars} | ${topStarred.forks} | ${topStarred.language} |\n`;
          md += `| ${topForked.name} | ${topForked.stars} | ${topForked.forks} | ${topForked.language} |\n`;

          fs.writeFileSync(options.output, md);
          console.log(`✅ Analysis exported to ${options.output}`);
          return;
        }

        console.log("⚠️ Unsupported format. Use json | csv | md");
        return;
      }

      // --- Console output (default) ---
      console.log("\n📊 Summary:");
      console.log(`- Total Repos: ${totalRepos}`);
      console.log(`- Total Stars: ${totalStars}`);
      console.log(`- Total Forks: ${totalForks}`);
      console.log(`- Avg Stars per Repo: ${avgStars}`);
      console.log(`- Avg Forks per Repo: ${avgForks}`);

      console.log("\n🌐 Language Breakdown:");
      const langTable = new Table({
        columns: [
          { name: "language", title: "Language" },
          { name: "count", title: "Repo Count" },
        ],
      });
      Object.entries(langCount).forEach(([lang, count]) =>
        langTable.addRow({ language: lang, count })
      );
      langTable.printTable();

      console.log("\n⭐ Top Repos:");
      const topTable = new Table({
        columns: [
          { name: "name", title: "Repo" },
          { name: "stars", title: "Stars" },
          { name: "forks", title: "Forks" },
          { name: "language", title: "Language" },
        ],
      });
      topTable.addRow(topStarred);
      topTable.addRow(topForked);
      topTable.printTable();
    });
}
