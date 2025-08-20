const fs = require('fs').promises;
const path = require('path');

class CheckpointManager {
  constructor(checkpointPath = './checkpoint.json') {
    this.checkpointPath = checkpointPath;
  }

  async saveCheckpoint(data) {
    try {
      const checkpointData = {
        ...data,
        lastUpdated: new Date().toISOString(),
        timestamp: Date.now()
      };
      
      await fs.writeFile(
        this.checkpointPath, 
        JSON.stringify(checkpointData, null, 2)
      );
      
      console.log(`💾 Checkpoint saved: ${JSON.stringify(checkpointData, null, 2)}`);
    } catch (error) {
      console.warn(`⚠️  Failed to save checkpoint: ${error.message}`);
    }
  }

  async loadCheckpoint() {
    try {
      const data = await fs.readFile(this.checkpointPath, 'utf8');
      const checkpoint = JSON.parse(data);
      console.log(`📂 Checkpoint loaded: ${JSON.stringify(checkpoint, null, 2)}`);
      return checkpoint;
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log('📂 No checkpoint found, starting fresh');
        return null;
      }
      console.warn(`⚠️  Failed to load checkpoint: ${error.message}`);
      return null;
    }
  }

  async clearCheckpoint() {
    try {
      await fs.unlink(this.checkpointPath);
      console.log('🗑️  Checkpoint cleared');
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn(`⚠️  Failed to clear checkpoint: ${error.message}`);
      }
    }
  }

  // Helper to determine if we should resume from checkpoint
  shouldResumeFromCheckpoint(checkpoint, org) {
    if (!checkpoint || checkpoint.org !== org) {
      return false;
    }

    // Resume if checkpoint is less than 1 hour old
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    return checkpoint.timestamp > oneHourAgo;
  }
}

module.exports = CheckpointManager;