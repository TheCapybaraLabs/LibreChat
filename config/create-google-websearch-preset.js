const path = require('path');
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
const mongoose = require('mongoose');
const { User, Preset } = require('@librechat/data-schemas').createModels(mongoose);
const { EModelEndpoint } = require('librechat-data-provider');
const connect = require('./connect');

/**
 * Creates a default Google preset with web search enabled for all users
 * Run with: node config/create-google-websearch-preset.js
 */

(async () => {
  await connect();

  console.log('Creating Google Web Search preset for all users...');

  try {
    // Get all users
    const users = await User.find({}).select('_id email').lean();
    console.log(`Found ${users.length} users`);

    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    for (const user of users) {
      const userId = user._id.toString();
      const presetId = `google-websearch-default-${userId}`;

      // Check if this preset already exists for this user
      const existingPreset = await Preset.findOne({ user: userId, presetId });

      const presetData = {
        user: userId,
        presetId,
        endpoint: EModelEndpoint.google,
        title: 'Google Gemini 2.0 com Busca Web',
        modelLabel: null,
        model: 'gemini-2.0-flash',
        promptPrefix: null,
        temperature: 1,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192,
        web_search: true, // Enable web search by default
        thinking: false, // Disable thinking for Gemini 2.0 models
        resendFiles: true,
        defaultPreset: true, // Make this the default preset
        order: 0,
      };

      if (existingPreset) {
        // Update existing preset
        await Preset.findByIdAndUpdate(existingPreset._id, { $set: presetData });
        updatedCount++;
        console.log(`Updated preset for user: ${user.email}`);
      } else {
        // Remove any existing default preset for this user first
        await Preset.updateMany(
          { user: userId, defaultPreset: true },
          { $unset: { defaultPreset: '', order: '' } },
        );

        // Create new preset
        await Preset.create(presetData);
        createdCount++;
        console.log(`Created preset for user: ${user.email}`);
      }
    }

    console.log('\n=== Summary ===');
    console.log(`Created: ${createdCount}`);
    console.log(`Updated: ${updatedCount}`);
    console.log(`Skipped: ${skippedCount}`);
    console.log(`Total users: ${users.length}`);
    console.log('\nDefault Google preset with web search enabled has been set for all users!');
  } catch (error) {
    console.error('Error creating presets:', error);
    process.exit(1);
  }

  process.exit(0);
})();
