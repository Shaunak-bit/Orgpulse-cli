import { MongoClient } from 'mongodb';

const ConnectionState = {
  DISCONNECTED: 0,
  CONNECTING: 1,
  CONNECTED: 2
};

let mongoClientInstance = null;
let databaseInstance = null;
let connectionState = ConnectionState.DISCONNECTED;

const DEFAULT_OPTIONS = {
  maxPoolSize: 10,
  connectTimeoutMS: 5000,
  serverSelectionTimeoutMS: 5000,
  retryWrites: true,
  retryReads: true
};

// Helper functions
async function cleanup() {
  connectionState = ConnectionState.DISCONNECTED;
  databaseInstance = null;
}

async function attemptReconnect() {
  if (connectionState !== ConnectionState.CONNECTED) return;
  console.log('⚡ Attempting reconnect...');
  await closeConnection();
  setTimeout(connectToMongo, 2000);
}

// Main exports
export async function connectToMongo() {
  if (connectionState === ConnectionState.CONNECTED) {
    return databaseInstance;
  }

  connectionState = ConnectionState.CONNECTING;
  const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/orgpulse';

  try {
    mongoClientInstance = new MongoClient(mongoUri, {
      ...DEFAULT_OPTIONS,
      ...(process.env.MONGO_OPTIONS ? JSON.parse(process.env.MONGO_OPTIONS) : {})
    });
    
    await mongoClientInstance.connect();
    databaseInstance = mongoClientInstance.db('orgpulse');
    connectionState = ConnectionState.CONNECTED;
    
    mongoClientInstance.on('serverClosed', cleanup);
    mongoClientInstance.on('serverHeartbeatFailed', attemptReconnect);
    
    console.log('✅ MongoDB connected');
    return databaseInstance;
  } catch (error) {
    connectionState = ConnectionState.DISCONNECTED;
    throw new Error(`Connection failed: ${error.message}`);
  }
}

export async function closeConnection() {
  try {
    if (mongoClientInstance) {
      await mongoClientInstance.close();
      mongoClientInstance = null;
      databaseInstance = null;
      connectionState = ConnectionState.DISCONNECTED;
      console.log('🔌 MongoDB connection closed gracefully');
    }
  } catch (error) {
    console.error('Error closing MongoDB connection:', error);
    throw error;
  }
}

export function getDb() {
  if (!databaseInstance) {
    throw new Error('Database not connected');
  }
  return databaseInstance;
}

// Graceful shutdown handler
process.on('SIGINT', async () => {
  await closeConnection();
  process.exit(0);
});