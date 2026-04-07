## Setup

```bash
cd backend
npm install
cp .env.example .env
# Edit .env with PostgreSQL credentials

# Create database and run migration
psql -U your_username -d your_db_name -f migration/query.sql

node server.js
```