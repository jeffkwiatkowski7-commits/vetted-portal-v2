# Backend Quick Start Guide

## Installation

Dependencies are already configured in `package.json`. The main server files are in `/server/`:

```
server/
├── index.js              # Main Express app with all API routes
├── database.js           # Database schema & initialization
├── mock-responses.js     # Mock AI response generator
└── seed.js              # Demo data seeding
```

## Running the Backend

### Development Mode

```bash
# Terminal 1 - Run backend
npm run dev:backend

# Terminal 2 - Run frontend (in project root)
npm run dev:frontend

# OR both together
npm run dev
```

The backend will start on **http://localhost:3000**

### Production Mode

```bash
# Build frontend
npm run build

# Run server in production
NODE_ENV=production npm start
```

## First Run

On first launch, the server will:
1. Create `/data/portal.db` SQLite database
2. Create all 18 tables with indexes
3. Seed comprehensive demo data
4. Display confirmation message

Check console for:
```
✓ Created 26 users
✓ Created 3 model configs
✓ Created 4 app categories
✓ Created 3 tool sets
✓ Created 2 system prompts
✓ Created 4 apps
✓ Created 15 projects
✓ Created 8 chats with 40+ messages
✓ Created 5 library files
✓ Created 4 notifications
✓ Created 26 user preferences
✅ Database seeding completed successfully!
```

## Default Demo Users

Login with these email addresses (no password required for demo):

```
admin@vetted.com              # Admin user (Sarah Chen)
james.wilson@company.com      # Senior Engineer
emily.rodriguez@company.com   # Data Analyst
michael.kim@company.com       # UX Designer
lisa.park@company.com         # Marketing Manager
david.thompson@company.com    # Finance Lead
```

Plus 20 generated users with pattern: `firstname.lastname@company.com`

## Testing the API

### 1. Get User ID (Login)

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@vetted.com"}'

# Response:
{
  "user": {
    "id": "uuid-here",
    "email": "admin@vetted.com",
    "display_name": "Sarah Chen",
    "role": "admin",
    "avatar_path": "/avatars/sarah-chen.jpg"
  }
}
```

### 2. Use User ID in Requests

All requests need `X-User-Id` header:

```bash
USER_ID="uuid-from-login"

# Get current user
curl http://localhost:3000/api/auth/me \
  -H "X-User-Id: $USER_ID"

# List chats
curl http://localhost:3000/api/chats \
  -H "X-User-Id: $USER_ID"

# Create chat
curl -X POST http://localhost:3000/api/chats \
  -H "X-User-Id: $USER_ID" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test Chat","model":"claude-opus"}'

# Send message (gets mock AI response)
curl -X POST http://localhost:3000/api/chats/[chat-id]/messages \
  -H "X-User-Id: $USER_ID" \
  -H "Content-Type: application/json" \
  -d '{"content":"Analyze the market trends"}'

# Upload file
curl -X POST http://localhost:3000/api/library/upload \
  -H "X-User-Id: $USER_ID" \
  -F "file=@yourfile.pdf"

# Get projects
curl http://localhost:3000/api/projects \
  -H "X-User-Id: $USER_ID"

# Get notifications
curl http://localhost:3000/api/notifications \
  -H "X-User-Id: $USER_ID"
```

### 3. Admin Operations

```bash
ADMIN_ID="uuid-of-admin-user"

# Get system stats
curl http://localhost:3000/api/admin/stats \
  -H "X-User-Id: $ADMIN_ID"

# List all users
curl http://localhost:3000/api/admin/users \
  -H "X-User-Id: $ADMIN_ID"

# Get health check
curl http://localhost:3000/api/admin/health
```

## Database Management

### View Database

```bash
# Install sqlite3 command-line tool (if needed)
apt-get install sqlite3

# Open database
sqlite3 data/portal.db

# List tables
.tables

# Query users
SELECT id, email, display_name, role FROM users;

# Query chats with message count
SELECT c.id, c.title, c.user_id, COUNT(m.id) as message_count
FROM chats c
LEFT JOIN messages m ON c.id = m.chat_id
GROUP BY c.id;

# Exit
.exit
```

### Reset Database

```bash
# Remove database files
rm data/portal.db*

# Restart server
npm run dev:backend
# or
npm run dev
```

The database will be recreated and seeded automatically.

## API Endpoints Summary

### Chat Routes
- `GET /api/chats` - List chats
- `POST /api/chats` - Create chat
- `POST /api/chats/:id/messages` - Send message (returns mock AI response)
- `POST /api/chats/:id/share` - Share chat with user

### Project Routes
- `GET /api/projects` - List projects
- `POST /api/projects` - Create project
- `POST /api/projects/:id/members` - Add member

### Library Routes
- `GET /api/library` - List files
- `POST /api/library/upload` - Upload file
- `DELETE /api/library/:id` - Delete file

### App Routes
- `GET /api/apps` - List apps
- `GET /api/apps/categories` - Get categories

### Settings Routes
- `GET /api/settings/profile` - Get profile
- `PUT /api/settings/preferences` - Update preferences
- `POST /api/settings/api-keys` - Create API key

### Search
- `GET /api/search?q=term` - Search

See `SERVER_DOCUMENTATION.md` for complete API reference.

## Mock AI Responses

The server includes mock responses that vary based on query keywords:

| Query Type | Pattern | Response Format |
|-----------|---------|-----------------|
| Analysis | `analyz*` | Structured analysis with tables |
| Summary | `summariz*` | Key points and takeaways |
| Writing | `write*` | Formatted proposals |
| Code | `code*` | Code blocks with explanations |
| Comparison | `compar*` | Comparison tables |
| Lists | `list*` | Numbered recommendations |
| Default | Other | Generic helpful response |

All responses include:
- Markdown formatting
- Reasoning/thinking data
- Model name mentioned
- Realistic token counts

## Troubleshooting

### Port Already in Use
```bash
# Use different port
PORT=3001 npm run dev:backend
```

### Database Locked
```bash
# Remove lock files and restart
rm data/portal.db-wal data/portal.db-shm
npm run dev:backend
```

### Module Not Found
```bash
# Reinstall dependencies
rm -rf node_modules
npm install --ignore-scripts
```

### CORS Errors
- Backend CORS is enabled for all origins
- Make sure frontend is making requests to `http://localhost:3000`
- Check `X-User-Id` header is included

## Development Notes

### Environment Variables

```bash
# Port (default: 3000)
PORT=3000

# Environment (default: development)
NODE_ENV=development

# Production example:
NODE_ENV=production PORT=8000 npm start
```

### File Structure

```
/data/
├── portal.db        # Main SQLite database
├── portal.db-wal    # Write-ahead log
└── portal.db-shm    # Shared memory

/uploads/
└── [uploaded files...]

/server/
├── index.js         # Main app
├── database.js      # Schema
├── mock-responses.js # Mock AI
└── seed.js          # Demo data
```

### Logs

Server logs appear in console:
```
Server running on port 3000 (development mode)
API available at http://localhost:3000/api
✓ Created 26 users
✓ Database seeding completed successfully!
```

## Next Steps

1. **Integrate Real LLM APIs:**
   - Replace `getMockResponse()` with real API calls
   - Add Anthropic, OpenAI, or Google API clients

2. **Authentication:**
   - Replace header-based demo auth with JWT
   - Add password hashing and login validation

3. **Frontend Integration:**
   - Connect frontend to API endpoints
   - Handle auth tokens properly
   - Implement error handling

4. **Database Upgrades:**
   - Consider PostgreSQL for production
   - Add connection pooling
   - Implement migrations framework

5. **Additional Features:**
   - WebSocket support for real-time updates
   - Rate limiting and request validation
   - Comprehensive logging and monitoring
   - Caching layer (Redis)

## Need Help?

Refer to:
- `SERVER_DOCUMENTATION.md` - Complete API reference
- Comments in `/server/index.js` - Route documentation
- Database schema in `/server/database.js` - Table definitions
