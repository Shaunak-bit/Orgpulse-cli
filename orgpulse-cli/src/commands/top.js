import { connectToMongo, closeConnection } from '../db/connection.js';

export default function topCommand(program) {
  program
    .command('top')
    .description('Show top repositories for an org')
    .requiredOption('--org <org>', 'GitHub organization name')
    .option('--metric <metric>', 'Metric to sort by (stars|issues)', 'stars')
    .option('--limit <number>', 'Number of repos to display', 10)
    .action(async (options) => {
      const db = await connectToMongo();
      try {
        const limit = parseInt(options.limit, 10);
        const repos = await db.collection('repos')
          .find({ org: options.org })
          .sort({ [options.metric === 'issues' ? 'openIssues' : 'stars']: -1 })
          .limit(limit)
          .toArray();

        if (!repos.length) {
          console.log(`⚠️ No repositories found for org ${options.org}`);
          return;
        }

        console.table(repos.map(r => ({
          Name: r.name,
          Stars: r.stars,
          Forks: r.forks,
          OpenIssues: r.openIssues,
        })));
      } catch (err) {
        console.error('❌ Error fetching top repos:', err.message);
      } finally {
        await closeConnection();
      }
    });
}
