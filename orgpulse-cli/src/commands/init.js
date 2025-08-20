import { connectToMongo, closeConnection } from './db/connection.js';
import { initializeDatabase } from './db/model.js';
import 'dotenv/config';

async function handleInitAction() {
  try {
    console.log('\n🔧 Initializing OrgPulse database...');

    if (!process.env.MONGO_URI) {
      throw new Error('Missing MONGO_URI in .env');
    }

    console.time('⏳ MongoDB connection');
    const db = await connectToMongo();
    console.timeEnd('⏳ MongoDB connection');

    console.log('⏳ Creating database indexes...');
    const startTime = Date.now();

    await initializeDatabase(db);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log('\n✅ Indexes created successfully');
    console.log(`⏱️  Operation completed in ${duration}s`);
    console.log('\n🎉 OrgPulse CLI initialized successfully!');

    return true;
  } catch (error) {
    console.error('\n❌ Initialization failed:');
    console.error('Error details:', error.message);

    if (error.message.includes('ECONNREFUSED')) {
      console.error('\n💡 Tip: Is MongoDB running? Try:');
      console.error('1. Check your MONGO_URI in .env');
      console.error('2. Start MongoDB with: docker compose up -d');
      console.error('3. Test manually: mongosh "mongodb://127.0.0.1:27017"');
    }

    process.exitCode = 1;
    return false;
  } finally {
    try {
      await closeConnection();
    } catch (closeError) {
      console.error('⚠️  Warning: Error closing connection:', closeError.message);
    }
  }
}

// Commander integration
export default function initCommand(program) {
  program
    .command('init')
    .description('Initialize database and create indexes')
    .action(async () => {
      const success = await handleInitAction();
      process.exit(success ? 0 : 1);
    });
}
