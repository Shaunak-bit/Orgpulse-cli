import { MongoClient } from 'mongodb';

async function testConnection() {
  const uri = 'mongodb://127.0.0.1:27017'; // Use IPv4 instead of IPv6 (::1)
  const client = new MongoClient(uri);

  try {
    // Connect to MongoDB
    await client.connect();
    console.log('✅ Connected successfully to MongoDB server');

    // Test database operations
    const db = client.db('testDB');
    const collection = db.collection('testCollection');
    
    // Insert a document
    await collection.insertOne({ name: 'Test', value: 123 });
    console.log('📝 Document inserted');

    // Find the document
    const found = await collection.findOne({ name: 'Test' });
    console.log('🔍 Found document:', found);

    // Clean up
    await collection.drop();
    console.log('🧹 Test collection dropped');

  } catch (err) {
    console.error('❌ Connection error:', err);
  } finally {
    await client.close();
  }
}

testConnection();