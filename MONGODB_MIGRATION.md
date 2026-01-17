# MongoDB Migration Guide

This guide will help you migrate your JSON file-based storage to MongoDB.

## Prerequisites

1. A MongoDB server (local or cloud-based like MongoDB Atlas)
2. MongoDB connection string
3. Node.js and npm installed

## Quick Start

### 1. Migrate Existing Data to MongoDB

Run the migration script with your MongoDB connection string:

```bash
node scripts/migrateToMongoDB.js "mongodb://localhost:27017" "reach_mobile"
```

Or for MongoDB Atlas (cloud):

```bash
node scripts/migrateToMongoDB.js "mongodb+srv://username:password@cluster.mongodb.net/reach_mobile" "reach_mobile"
```

### 2. Configure Your Application

Create a `.env` file in the project root:

```env
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB_NAME=reach_mobile
```

Or for MongoDB Atlas:

```env
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/reach_mobile
MONGODB_DB_NAME=reach_mobile
```

### 3. Start Your Application

The application will automatically detect the MongoDB connection and use it instead of JSON files:

```bash
npm start
```

## Connection String Formats

### Local MongoDB
```
mongodb://localhost:27017
```

### MongoDB with Authentication
```
mongodb://username:password@localhost:27017/database
```

### MongoDB Atlas (Cloud)
```
mongodb+srv://username:password@cluster.mongodb.net/database
```

## Migration Details

The migration script will:

1. **Flow Context**: Migrate all session flow contexts from `data/flowContext.json`
2. **Carts**: Migrate all cart data from `data/carts.json`
3. **State**: Migrate application state from `data/state.json`

All existing data in your JSON files will be preserved as backups.

## Fallback Behavior

The application automatically falls back to JSON file storage if:
- `MONGODB_URI` is not set
- MongoDB connection fails
- MongoDB operations fail

This ensures your application continues to work even if MongoDB is unavailable.

## Database Collections

The following collections will be created in MongoDB:

- `flowContext` - Session flow contexts
- `carts` - Shopping cart data
- `state` - Application state

Indexes are automatically created for better performance:
- `sessionId` (unique index) on `flowContext` and `carts`
- `lastUpdated` (index) on `flowContext` for cleanup queries

## Troubleshooting

### Connection Issues

If you see connection errors:

1. **Check your connection string format**
   - Verify username, password, and cluster URL
   - Ensure special characters in password are URL-encoded

2. **Check network access**
   - For MongoDB Atlas, verify your IP address is whitelisted
   - Check firewall settings for local MongoDB

3. **Verify credentials**
   - Ensure username and password are correct
   - Check database user permissions

### Migration Errors

If migration fails:

1. **Check JSON file validity**
   ```bash
   node -e "JSON.parse(require('fs').readFileSync('data/flowContext.json', 'utf8'))"
   ```

2. **Verify MongoDB access**
   - Test connection with MongoDB Compass or `mongo` CLI
   - Check database user has read/write permissions

3. **Check disk space**
   - Ensure sufficient space for MongoDB database

### Application Still Using JSON Files

If the application still uses JSON after setting `MONGODB_URI`:

1. Verify `.env` file is loaded (if using dotenv)
2. Check `MONGODB_URI` environment variable is set correctly
3. Restart the application after setting environment variables

## Benefits of MongoDB

- **Scalability**: Better performance with large datasets
- **Reliability**: ACID transactions and data consistency
- **Backup**: Built-in replication and backup features
- **Querying**: Advanced query capabilities
- **Indexing**: Better performance with proper indexes

## Rollback

If you need to rollback to JSON files:

1. Remove or comment out `MONGODB_URI` in `.env`
2. Restart the application
3. Your JSON files will continue to work as before

The JSON files are never deleted during migration, so your data is safe.
