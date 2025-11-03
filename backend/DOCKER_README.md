# Docker Setup for Swellyo Backend

This guide explains how to build and run the Swellyo backend using Docker.

## Prerequisites

- Docker installed on your system
- Docker Compose (usually comes with Docker Desktop)

## Quick Start

### 1. Set up Environment Variables

Copy the example environment file and add your OpenAI API key:

```bash
cp env.example .env
```

Edit `.env` and add your actual OpenAI API key:
```
OPEN_AI_API_KEY=sk-your-actual-openai-api-key-here
```

### 2. Build and Run with Docker Compose

```bash
# Build and start the container
docker-compose up --build

# Or run in detached mode (background)
docker-compose up --build -d
```

The API will be available at `http://localhost:8000`

### 3. Stop the Container

```bash
docker-compose down
```

## Alternative: Using Docker Commands Directly

### Build the Image

```bash
docker build -t swellyo-backend .
```

### Run the Container

```bash
docker run -p 8000:8000 --env-file .env swellyo-backend
```

## Development Mode

For development with live code reloading, you can mount your source code:

```bash
docker-compose up --build
```

The `docker-compose.yml` already includes volume mounting for development.

## Production Deployment

For production, you should:

1. Remove the volume mount from `docker-compose.yml` (comment out the volumes section)
2. Use environment variables or secrets management
3. Consider adding a reverse proxy (nginx example is commented in docker-compose.yml)
4. Use a proper logging solution

## Health Check

The container includes a health check that monitors the `/health` endpoint:

```bash
# Check container health
docker ps
```

## API Endpoints

Once running, you can test the API:

- Health check: `GET http://localhost:8000/health`
- API docs: `GET http://localhost:8000/docs`
- New chat: `POST http://localhost:8000/new_chat`

## Troubleshooting

### Container won't start
- Check if port 8000 is already in use: `lsof -i :8000`
- Verify your `.env` file has the correct OpenAI API key
- Check container logs: `docker-compose logs swellyo-backend`

### API not responding
- Ensure the container is running: `docker ps`
- Check the health endpoint: `curl http://localhost:8000/health`
- Review logs: `docker-compose logs -f swellyo-backend`

### Build issues
- Clear Docker cache: `docker system prune -a`
- Rebuild without cache: `docker-compose build --no-cache`

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `OPEN_AI_API_KEY` | Your OpenAI API key | Yes |
| `PORT` | Port to run the server on (default: 8000) | No |
| `DEBUG` | Enable debug mode | No |
| `LOG_LEVEL` | Logging level | No |

## Security Notes

- The Dockerfile creates a non-root user for security
- Never commit your `.env` file with real API keys
- In production, use Docker secrets or environment variable injection
- Consider using a reverse proxy for SSL termination
