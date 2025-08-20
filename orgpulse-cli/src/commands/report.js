import axios from "axios";
import fs from "fs";
import inquirer from "inquirer";
import { Table } from "console-table-printer";

export default function reportCommand(program) {
  program
    .command("report <org>")
    .description("Generate a repo report")
    .option("--top <n>", "Limit number of repos", parseInt)
    .option("--format <type>", "Export format: json | csv | md | html | console")
    .option("--output <file>", "File to save the output (if exporting)")
    .option("--filterStars <n>", "Filter repos by minimum stars", parseInt)
    .option("--filterForks <n>", "Filter repos by minimum forks", parseInt)
    .option("--lang <language>", "Filter by primary language")
    .option("--or", "Use OR instead of AND for filtering")
    .option("--sort <fields...>", "Sort by: stars, forks (multiple allowed)")
    .option("--interactive", "Run in interactive mode")
    .action(async (org, options) => {
      console.log(`📊 Generating report for: ${org}`);

      // --- Interactive Prompt ---
      if (options.interactive) {
        const answers = await inquirer.prompt([
          {
            type: "input",
            name: "top",
            message: "How many repos do you want to include? (leave blank for all)",
          },
          {
            type: "checkbox",
            name: "sort",
            message: "Sort by? (select one or more, order matters)",
            choices: ["stars", "forks"],
          },
          {
            type: "input",
            name: "filterStars",
            message: "Minimum stars? (leave blank for none)",
          },
          {
            type: "input",
            name: "filterForks",
            message: "Minimum forks? (leave blank for none)",
          },
          {
            type: "input",
            name: "lang",
            message: "Filter by language? (leave blank for all)",
          },
          {
            type: "list",
            name: "logic",
            message: "Combine filters with?",
            choices: ["AND", "OR"],
            default: "AND",
          },
          {
            type: "list",
            name: "format",
            message: "Export format?",
            choices: ["console", "json", "csv", "md", "html"],
            default: "console",
          },
          {
            type: "input",
            name: "output",
            message: "Output file (only if exporting, leave blank for console):",
          },
        ]);

        // Merge answers into options
        options.top = answers.top ? parseInt(answers.top) : undefined;
        options.sort = answers.sort.length > 0 ? answers.sort : undefined;
        options.filterStars = answers.filterStars
          ? parseInt(answers.filterStars)
          : undefined;
        options.filterForks = answers.filterForks
          ? parseInt(answers.filterForks)
          : undefined;
        options.lang = answers.lang || undefined;
        options.or = answers.logic === "OR";
        options.format = answers.format;
        options.output = answers.output || undefined;
      }

      // === Fetch Repos ===
      let repos = [];
      try {
        const url = `https://api.github.com/orgs/${org}/repos?per_page=100`;
        const res = await axios.get(url);
        repos = res.data.map((repo) => ({
          name: repo.name,
          stars: repo.stargazers_count,
          forks: repo.forks_count,
          language: repo.language || "Unknown",
          url: repo.html_url,
        }));
      } catch (err) {
        console.error(
          "❌ Failed to fetch repositories. Check org name or API rate limit."
        );
        return;
      }

      // === Filtering ===
      if (options.filterStars || options.filterForks || options.lang) {
        repos = repos.filter((repo) => {
          const starCond = options.filterStars ? repo.stars >= options.filterStars : true;
          const forkCond = options.filterForks ? repo.forks >= options.filterForks : true;
          const langCond = options.lang
            ? repo.language?.toLowerCase() === options.lang.toLowerCase()
            : true;

          return options.or ? starCond || forkCond || langCond : starCond && forkCond && langCond;
        });
      }

      // === Sorting ===
      if (options.sort && options.sort.length > 0) {
        repos.sort((a, b) => {
          for (const field of options.sort) {
            if (b[field] !== a[field]) {
              return b[field] - a[field]; // Descending
            }
          }
          return 0;
        });
      }

      // === Limit ===
      if (options.top) {
        repos = repos.slice(0, options.top);
      }

      // === Export ===
      if (options.format && options.format !== "console") {
        if (!options.output) {
          console.log("⚠️ Please provide --output <file> to save the export.");
          return;
        }

        // --- Auto-append extension ---
        const extMap = { json: ".json", csv: ".csv", md: ".md", html: ".html" };
        if (!options.output.endsWith(extMap[options.format])) {
          options.output += extMap[options.format];
        }

        // --- Overwrite check ---
        if (fs.existsSync(options.output)) {
          const answer = await inquirer.prompt([
            {
              type: "confirm",
              name: "overwrite",
              message: `⚠️ File "${options.output}" already exists. Overwrite?`,
              default: false,
            },
          ]);
          if (!answer.overwrite) {
            console.log("❌ Export cancelled.");
            return;
          }
        }

        if (options.format === "json") {
          fs.writeFileSync(options.output, JSON.stringify(repos, null, 2));
        } else if (options.format === "csv") {
          const csvData = [
            ["Repo", "Stars", "Forks", "Language", "URL"],
            ...repos.map((r) => [r.name, r.stars, r.forks, r.language, r.url]),
          ]
            .map((row) => row.map((v) => `"${v}"`).join(","))
            .join("\n");
          fs.writeFileSync(options.output, csvData);
        } else if (options.format === "md") {
          let md = `# 📊 Repo Report: ${org}\n\n`;
          md += `| Repo | Stars | Forks | Language |\n`;
          md += `|------|-------|-------|----------|\n`;
          repos.forEach((r) => {
            md += `| [${r.name}](${r.url}) | **${r.stars}** | **${r.forks}** | ${r.language} |\n`;
          });
          fs.writeFileSync(options.output, md);
        } else if (options.format === "html") {
          let html = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Repo Report: ${org}</title>
<style>
  body { font-family: Arial, sans-serif; margin: 20px; background: #f9f9f9; }
  h1 { color: #333; }
  table { border-collapse: collapse; width: 100%; background: white; }
  th, td { border: 1px solid #ccc; padding: 8px 12px; text-align: left; }
  th { background: #0366d6; color: white; }
  tr:nth-child(even) { background: #f2f2f2; }
  tr:hover { background: #dbe9ff; }
  a { color: #0366d6; text-decoration: none; }
  a:hover { text-decoration: underline; }
</style>
</head>
<body>
<h1>📊 Repo Report: ${org}</h1>
<table>
  <thead>
    <tr>
      <th>Repo</th>
      <th>Stars</th>
      <th>Forks</th>
      <th>Language</th>
    </tr>
  </thead>
  <tbody>
    ${repos
      .map(
        (r) => `
    <tr>
      <td><a href="${r.url}" target="_blank">${r.name}</a></td>
      <td>${r.stars}</td>
      <td>${r.forks}</td>
      <td>${r.language}</td>
    </tr>`
      )
      .join("")}
  </tbody>
</table>
</body>
</html>`;
          fs.writeFileSync(options.output, html);
        }

        console.log(`✅ Report exported to ${options.output}`);
        return;
      }

      // === Console Table (default) ===
      const table = new Table({
        columns: [
          { name: "name", title: "Repo" },
          { name: "stars", title: "Stars" },
          { name: "forks", title: "Forks" },
          { name: "language", title: "Language" },
        ],
      });

      repos.forEach((repo) =>
        table.addRow({
          name: repo.name,
          stars: repo.stars,
          forks: repo.forks,
          language: repo.language,
        })
      );

      table.printTable();
    });
}
