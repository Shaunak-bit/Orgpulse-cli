// src/db/models/repos.js
export async function createRepoCollection(db) {
    const repos = db.collection('repos');
    
    await repos.createIndex(
        { org: 1, name: 1 },
        { unique: true }
    );
    
    await repos.createIndex(
        { org: 1, stars: -1 }
    );
    
    return repos;
}