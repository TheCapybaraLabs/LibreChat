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
  console.purple('Delete files older than specified days');
  console.purple('--------------------------');

  /**
   * Set up the variables we need and get the arguments if they were passed in
   */
  let days = '';
  let dryRun = false;
  let deletePhysicalFiles = false;

  // Check for flags
  if (process.argv.includes('--dry-run')) {
    dryRun = true;
  }
  if (process.argv.includes('--delete-physical')) {
    deletePhysicalFiles = true;
  }

  // Get days from arguments
  const filteredArgs = process.argv.filter(
    (arg) => arg !== '--dry-run' && arg !== '--delete-physical',
  );
  if (filteredArgs.length >= 3) {
    days = filteredArgs[2];
  }

  if (!days) {
    console.orange('Usage: node config/delete-old-files.js <days> [--dry-run] [--delete-physical]');
    console.orange('Example: node config/delete-old-files.js 30 --dry-run');
    console.orange('Flags:');
    console.orange('  --dry-run          Show what would be deleted without actually deleting');
    console.orange('  --delete-physical  Also delete physical files from disk (use with caution!)');
    console.purple('--------------------------');
    days = await askQuestion('Delete files older than how many days?:');
  }

  // Validate the days
  const daysNum = parseInt(days, 10);
  if (isNaN(daysNum) || daysNum <= 0) {
    console.red('Error: Please specify a valid number of days!');
    silentExit(1);
  }

  // Calculate the cutoff date
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysNum);

  console.purple(`Searching for files older than ${daysNum} days (before ${cutoffDate.toISOString()})`);
  if (dryRun) {
    console.orange('DRY RUN MODE - No files will be deleted');
  }

  // Find files older than the cutoff date
  let files;
  try {
    files = await File.find({
      createdAt: { $lt: cutoffDate },
    }).lean();
  } catch (error) {
    console.red(`Error querying database: ${error.message}`);
    silentExit(1);
  }

  if (!files || files.length === 0) {
    console.orange(`No files found older than ${daysNum} days`);
    silentExit(0);
  }

  console.purple(`Found ${files.length} files older than ${daysNum} days`);

  // Group by context for better visibility
  const contextGroups = {};
  files.forEach((file) => {
    const ctx = file.context || 'unknown';
    if (!contextGroups[ctx]) {
      contextGroups[ctx] = [];
    }
    contextGroups[ctx].push(file);
  });

  console.purple('\nFiles grouped by context:');
  for (const [ctx, ctxFiles] of Object.entries(contextGroups)) {
    const ctxBytes = ctxFiles.reduce((sum, file) => sum + (file.bytes || 0), 0);
    const ctxMB = (ctxBytes / (1024 * 1024)).toFixed(2);
    console.purple(`  ${ctx}: ${ctxFiles.length} files (${ctxMB} MB)`);
  }

  // Show sample of oldest files
  const sortedFiles = files.sort((a, b) => a.createdAt - b.createdAt);
  const sampleSize = Math.min(5, files.length);
  console.purple('\nOldest files to be deleted:');
  for (let i = 0; i < sampleSize; i++) {
    const file = sortedFiles[i];
    const age = Math.floor((Date.now() - new Date(file.createdAt)) / (1000 * 60 * 60 * 24));
    console.purple(`  - ${file.filename} (${age} days old, ${file.context || 'unknown'})`);
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
    `\nAre you sure you want to delete ${files.length} files older than ${daysNum} days? (yes/no):`,
  );
  if (confirmation.toLowerCase() !== 'yes') {
    console.orange('Operation cancelled.');
    silentExit(0);
  }

  let dbDeleteCount = 0;
  let dbErrorCount = 0;
  let physicalDeleteCount = 0;
  let physicalErrorCount = 0;
  let physicalSkipCount = 0;

  // Delete files from database
  console.purple('\nDeleting files...');
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
            } catch (accessError) {
              physicalErrorCount++;
            }
            
            if (dbDeleteCount % 10 === 0) {
              // Show progress every 10 files
              console.purple(`  Progress: ${dbDeleteCount}/${files.length} (Physical: ${physicalDeleteCount})`);
            }
          } else {
            physicalSkipCount++;
          }
        } catch (fsError) {
          physicalErrorCount++;
          // File might already be deleted or not exist
        }
      } else {
        if (dbDeleteCount % 10 === 0) {
          // Show progress every 10 files
          console.purple(`  Progress: ${dbDeleteCount}/${files.length}`);
        }
      }
    } catch (error) {
      dbErrorCount++;
      console.red(`  ✗ Failed to delete ${file.filename}: ${error.message}`);
    }
  }

  console.green(`\n✓ Database deletion completed: ${dbDeleteCount} successful, ${dbErrorCount} failed`);
  if (deletePhysicalFiles) {
    console.green(`✓ Physical file deletion: ${physicalDeleteCount} successful, ${physicalErrorCount} failed/not found, ${physicalSkipCount} skipped (URLs)`);
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
