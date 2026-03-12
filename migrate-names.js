/**
 * Migration Script: Add name field to existing users
 * Run once: node migrate-names.js
 */

const mongoose = require('mongoose');
const config = require('./config/config');

async function migrate() {
  try {
    await mongoose.connect(config.mongodb.uri);
    console.log('✅ Connected to MongoDB');

    // Define User schema inline to avoid model caching issues
    const userSchema = new mongoose.Schema({
      name: {
        type: String,
        required: false,
        trim: true,
        maxlength: [100, 'Name cannot exceed 100 characters']
      },
      email: {
        type: String,
        required: true,
        lowercase: true,
        trim: true
      },
      password: {
        type: String,
        required: true,
        select: false
      },
      avatarUrl: {
        type: String,
        default: null
      },
      plan: {
        type: String,
        default: 'free'
      },
      dailyUsage: {
        count: { type: Number, default: 0 },
        lastReset: { type: Date, default: Date.now }
      },
      isActive: {
        type: Boolean,
        default: true
      }
    }, { timestamps: true });

    const User = mongoose.model('User', userSchema);

    // Find users without name field or with empty name
    const usersWithoutName = await User.find({
      $or: [
        { name: { $exists: false } },
        { name: null },
        { name: '' }
      ]
    });

    console.log(`📊 Found ${usersWithoutName.length} users without name`);

    if (usersWithoutName.length === 0) {
      console.log('✅ No users need migration');
      process.exit(0);
    }

    // Update each user
    let updated = 0;
    for (const user of usersWithoutName) {
      const oldName = user.email.split('@')[0];
      user.name = oldName;
      await user.save();
      console.log(`   Updated: ${user.email} → "${oldName}"`);
      updated++;
    }

    console.log(`\n✅ Migration complete! Updated ${updated} users`);

    // Verify
    const remaining = await User.countDocuments({
      $or: [
        { name: { $exists: false } },
        { name: null },
        { name: '' }
      ]
    });
    console.log(`📊 Remaining users without name: ${remaining}`);

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

migrate();
