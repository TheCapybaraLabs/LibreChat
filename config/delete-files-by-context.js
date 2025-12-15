const path = require('path');
const fs = require('fs').promises;
const mongoose = require('mongoose');
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
const { File } = require('@librechat/data-schemas').createModels(mongoose);
const { askQuestion, silentExit } = require('./helpers');
const connect = require('./connect');

(async () => {
  await connect();

  /**
   * Show the welcome / help menu
   */
  console.purple('--------------------------');
  console.purple('Delete files by context (e.g., assistants, agents, etc.)');
  console.purple('--------------------------');

  /**
   * Set up the variables we need and get the arguments if they were passed in
   */
  let context = '';
  let dryRun = false;
  let deletePhysicalFiles = false;

  // Check for flags
  if (process.argv.includes('--dry-run')) {
    dryRun = true;
  }
  if (process.argv.includes('--delete-physical')) {
    deletePhysicalFiles = true;
  }

  // Get context from arguments
  const filteredArgs = process.argv.filter(
    (arg) => arg !== '--dry-run' && arg !== '--delete-physical',
  );
  if (filteredArgs.length >= 3) {
    context = filteredArgs[2];
  }

  if (!context) {
    console.orange('Usage: node config/delete-files-by-context.js <context> [--dry-run] [--delete-physical]');
    console.orange('Available contexts: assistants, agents, execute_code, image_generation, message_attachment');
    console.orange('Flags:');
    console.orange('  --dry-run          Show what would be deleted without actually deleting');
    console.orange('  --delete-physical  Also delete physical files from disk (use with caution!)');
    console.purple('--------------------------');
    context = await askQuestion('Enter context (e.g., assistants, agents):');
  }

  // Validate the context
  if (!context) {
    console.red('Error: Please specify a context!');
    silentExit(1);
  }

  console.purple(`Searching for files with context: ${context}`);
  if (dryRun) {
    console.orange('DRY RUN MODE - No files will be deleted');
  }

  // Find files with the specified context
  let files;
  try {
    files = await File.find({ context }).lean();
  } catch (error) {
    console.red(`Error querying database: ${error.message}`);
    silentExit(1);
  }

  if (!files || files.length === 0) {
    console.orange(`No files found with context: ${context}`);
    silentExit(0);
  }

  console.purple(`Found ${files.length} files with context: ${context}`);
  
  // Show sample of files
  const sampleSize = Math.min(5, files.length);
  console.purple('\nSample of files to be deleted:');
  for (let i = 0; i < sampleSize; i++) {
    console.purple(`  - ${files[i].filename} (${files[i].bytes} bytes) - User: ${files[i].user}`);
  }
  if (files.length > sampleSize) {
    console.purple(`  ... and ${files.length - sampleSize} more files`);
  }

  // Calculate total size
  const totalBytes = files.reduce((sum, file) => sum + (file.bytes || 0), 0);
  const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);
  console.purple(`\nTotal size: ${totalMB} MB`);

  if (dryRun) {
    console.green('\nDRY RUN - These files would be deleted.');
    silentExit(0);
  }

  // Confirm the action
  const confirmation = await askQuestion(
    `\nAre you sure you want to delete ${files.length} files with context "${context}"? (yes/no):`,
  );
  if (confirmation.toLowerCase() !== 'yes') {
    console.orange('Operation cancelled.');
    silentExit(0);
  }

  let dbDeleteCount = 0;
  let dbErrorCount = 0;
  let physicalDeleteCount = 0;
  let physicalErrorCount = 0;

  // Delete files from database
  console.purple('\nDeleting files from database...');
  for (const file of files) {
    try {
      await File.deleteOne({ _id: file._id });
      dbDeleteCount++;
      
      // Delete physical file if flag is set
      if (deletePhysicalFiles && file.filepath) {
        try {
          // Only attempt to delete local files (source is 'local' or undefined for legacy records)
          const isLocalFile = !file.source || file.source === 'local';
          const isNotUrl = !file.filepath.startsWith('http://') && !file.filepath.startsWith('https://');
          
          if (isLocalFile && isNotUrl) {
            // Construct absolute path - filepath might be relative or absolute
            let fullPath = file.filepath;
            if (!path.isAbsolute(fullPath)) {
              fullPath = path.resolve(__dirname, '..', fullPath);
            }
            
            // Check if file exists before attempting deletion
            try {
              await fs.access(fullPath);
              await fs.unlink(fullPath);
              physicalDeleteCount++;
              console.purple(`  ✓ Deleted: ${file.filename} (DB + Physical)`);
            } catch (accessError) {
              physicalErrorCount++;
              console.orange(`  ✓ Deleted from DB: ${file.filename} (Physical file not found)`);
            }
          } else {
            console.orange(`  ✓ Deleted: ${file.filename} (DB only - Remote file: ${file.source || 'unknown'})`);
          }
        } catch (fsError) {
          physicalErrorCount++;
          console.orange(`  ✓ Deleted from DB: ${file.filename} (Physical deletion error: ${fsError.message})`);
        }
      } else {
        console.purple(`  ✓ Deleted: ${file.filename}`);
      }
    } catch (error) {
      dbErrorCount++;
      console.red(`  ✗ Failed to delete ${file.filename}: ${error.message}`);
    }
  }

  console.green(`\n✓ Database deletion completed: ${dbDeleteCount} successful, ${dbErrorCount} failed`);
  if (deletePhysicalFiles) {
    console.green(`✓ Physical file deletion: ${physicalDeleteCount} successful, ${physicalErrorCount} failed`);
  }
  
  silentExit(0);
})();

process.on('uncaughtException', (err) => {
  if (!err.message.includes('fetch failed')) {
    console.error('There was an uncaught error:');
    console.error(err);
  }

  if (err.message.includes('fetch failed')) {
    return;
  } else {
    process.exit(1);
  }
});
