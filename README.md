# JD-Agent

An AI-powered web application that streamlines the creation, management, and approval of Job Descriptions (JDs) through interactive, conversational interviews with employees.

## Features

- **Conversational JD Creation**: AI-driven interviews to gather comprehensive job insights
- **Multi-Agent AI Framework**: Uses LangGraph and Google Gemini for intelligent conversations
- **Vector Search**: Pinecone integration for semantic similarity and retrieval
- **Dashboard**: HR and admin panels for managing JDs and analytics
- **Feedback & Approval**: Review workflows with comments and version control
- **PDF Generation**: Export JDs as formatted documents

## Tech Stack

- **Backend**: FastAPI (Python), PostgreSQL, Redis
- **Frontend**: Next.js (React), TypeScript, Tailwind CSS
- **AI**: Google Gemini, LangChain, LangGraph, Pinecone
- **Deployment**: Docker Compose

## Prerequisites

- Docker and Docker Compose
- Node.js 20+ (for local frontend development)
- Python 3.11+ (for local backend development)

## Quick Start with Docker

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd jd-agent
   ```

2. **Set up environment variables**
   ```bash
   cp backend/.env.example backend/.env
   cp frontend/.env.example frontend/.env
   ```

   Edit `backend/.env` with your API keys and database credentials:
   ```
   GEMINI_API_KEY=your_gemini_api_key
   PINECONE_API_KEY=your_pinecone_api_key
   DATABASE_PASS=your_db_password
   SECRET_KEY=your_secret_key
   ADMIN_CODE=your_admin_code
   ADMIN_PASSWORD=your_admin_password
   ```

3. **Start the application**
   ```bash
   docker-compose up --build
   ```

   The application will be available at:
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:8000
   - API Documentation: http://localhost:8000/docs

## Local Development Setup

### Backend

1. **Create virtual environment**
   ```bash
   cd backend
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

2. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

3. **Set up database**
   ```bash
   # Start PostgreSQL and Redis (or use cloud services)
   # Update .env with database credentials
   ```

4. **Run database migrations**
   ```bash
   alembic upgrade head
   ```

5. **Start the backend**
   ```bash
   uvicorn app.main:app --reload
   ```

### Frontend

1. **Install dependencies**
   ```bash
   cd frontend
   npm install
   ```

2. **Start the development server**
   ```bash
   npm run dev
   ```

## Configuration

### Environment Variables

See `backend/.env.example` and `frontend/.env.example` for all required variables.

**Required for Backend:**
- `DATABASE_NAME`, `DATABASE_USER_NAME`, `DATABASE_PASS`, `DATABASE_HOST`, `DATABASE_PORT`
- `GEMINI_API_KEY`
- `PINECONE_API_KEY`
- `SECRET_KEY`
- `ADMIN_CODE`, `ADMIN_PASSWORD`

**Required for Frontend:**
- `NEXT_PUBLIC_API_URL`

## Database Setup

The application uses PostgreSQL with SQLAlchemy. Tables are created automatically on startup via `init_db()`.

For production deployments:
1. Run migrations: `alembic upgrade head`
2. Or use the auto-initialization in the app

## API Endpoints

- `GET /docs` - API documentation
- `POST /auth/login` - Admin login
- `POST /jd/start` - Start JD interview
- `GET /jd/{session_id}` - Get JD session
- `POST /feedback/submit` - Submit feedback

## Deployment

### Production with Docker Compose

1. Update environment variables for production
2. Use external PostgreSQL and Redis services
3. Run `docker-compose up -d`

### Manual Deployment

1. Set up PostgreSQL and Redis
2. Configure reverse proxy (nginx) for frontend
3. Use process manager (gunicorn) for backend
4. Set up SSL certificates

## Development

### Running Tests

```bash
# Backend tests
cd backend
pytest

# Frontend tests
cd frontend
npm test
```

### Code Quality

```bash
# Backend linting
cd backend
ruff check .

# Frontend linting
cd frontend
npm run lint
```

### Database Migrations

```bash
cd backend
alembic revision --autogenerate -m "description"
alembic upgrade head
```

## Project Structure

```
jd-agent/
├── backend/
│   ├── app/
│   │   ├── agents/          # AI conversation logic
│   │   ├── core/            # Config, database, auth
│   │   ├── models/          # SQLAlchemy models
│   │   ├── routers/         # API endpoints
│   │   ├── schemas/         # Pydantic schemas
│   │   └── services/        # Business logic
│   ├── alembic/             # Database migrations
│   └── requirements.txt
├── frontend/
│   ├── app/                 # Next.js app router
│   ├── components/          # React components
│   ├── hooks/               # Custom React hooks
│   └── types/               # TypeScript types
├── docker-compose.yaml
└── README.md
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes with tests
4. Submit a pull request

## License

[License information]