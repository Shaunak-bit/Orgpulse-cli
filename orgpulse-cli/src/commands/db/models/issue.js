// src/db/models/issues.js
export async function createIssueCollection(db) {
    const issues = db.collection('issues');
    
    await issues.createIndex(
        { repo: 1, state: 1 }
    );
    
    await issues.createIndex(
        { repo: 1, number: 1 },
        { unique: true }
    );
    
    return issues;
}