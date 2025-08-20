import { connectToMongo, closeConnection } from '../db/connection.js';
import { writeFileSync } from 'fs';

export default function exportCommand(program) {
  program
    .command('export')
    .description('Export repository data to CSV')
    .requiredOption('--org <org>', 'GitHub organization name')
    .requiredOption('--out <path>', 'Output CSV file path')
    .action(async (options) => {
      const db = await connectToMongo();
      try {
        console.log(`\nExporting ${options.org} repos to ${options.out}...`);

        const repos = await db.collection('repos')
          .find({ org: options.org })
          .sort({ stars: -1 })
          .toArray();

        if (!repos.length) {
          console.log(`⚠️ No repositories found for org ${options.org}`);
          return;
        }

        // CSV header
        let csv = 'name,stars,forks,openIssues,pushedAt,language\n';

        repos.forEach(repo => {
          const name = `"${(repo.name || '').replace(/"/g, '""').trim()}"`;
          const stars = repo.stars || 0;
          const forks = repo.forks || 0;
          const openIssues = repo.openIssues || 0;
          const pushedAt = repo.pushedAt ? new Date(repo.pushedAt).toISOString() : '';
          const language = `"${(repo.language || '').replace(/"/g, '""').trim()}"`;

          csv += [name, stars, forks, openIssues, pushedAt, language].join(',') + '\n';
        });

        writeFileSync(options.out, csv);
        console.log(`✅ Exported ${repos.length} repositories to ${options.out}`);
      } catch (error) {
        console.error('\n❌ Export failed:', error.message);
        process.exit(1);
      } finally {
        await closeConnection();
      }
    });
}
