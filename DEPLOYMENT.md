# JSHookMCP Deployment Guide

## Prerequisites
- Node.js v20+ (or Docker for containerized deployments)
- pnpm (for dependency management)
- Environment variables (see `.env.example`)

---

## Local Deployment
### 1. Install Dependencies
```bash
pnpm install
```

### 2. Configure Environment Variables
```bash
cp .env.example .env
# Edit .env with your configuration
```

### 3. Start the Server
```bash
pnpm start
```

---

## Docker Deployment
### 1. Build the Docker Image
```bash
docker build -t jshookmcp .
```

### 2. Run the Container
```bash
# Using .env file
docker run -p 3000:3000 --env-file .env jshookmcp

# Override PORT
docker run -p 8080:8080 -e PORT=8080 --env-file .env jshookmcp
```

### 3. Docker Compose (Optional)
Create `docker-compose.yml`:
```yaml
version: '3.8'
services:
  jshookmcp:
    build: .
    ports:
      - "3000:3000"
    env_file: .env
    restart: unless-stopped
```

Start the service:
```bash
docker-compose up -d
```

---

## Cloud Deployment
### Manufact Cloud
1. **Push the Docker Image** to a registry:
   ```bash
   docker tag jshookmcp your-registry/jshookmcp:latest
   docker push your-registry/jshookmcp:latest
   ```

2. **Deploy** using the `mcp-deploy` CLI:
   ```bash
   mcp-deploy --image your-registry/jshookmcp:latest --env-file .env
   ```

### AWS (ECS/Fargate)
1. **Push the Docker Image** to Amazon ECR:
   ```bash
aws ecr get-login-password | docker login --username AWS --password-stdin your-account-id.dkr.ecr.your-region.amazonaws.com
   docker tag jshookmcp:latest your-account-id.dkr.ecr.your-region.amazonaws.com/jshookmcp:latest
   docker push your-account-id.dkr.ecr.your-region.amazonaws.com/jshookmcp:latest
   ```

2. **Deploy** using AWS ECS or Fargate.

### Google Cloud (Cloud Run)
1. **Push the Docker Image** to Google Container Registry:
   ```bash
docker tag jshookmcp gcr.io/your-project-id/jshookmcp
   docker push gcr.io/your-project-id/jshookmcp
   ```

2. **Deploy** using Cloud Run:
   ```bash
gcloud run deploy jshookmcp --image gcr.io/your-project-id/jshookmcp --platform managed --region your-region --allow-unauthenticated
   ```

---

## CI/CD (GitHub Actions)
Create `.github/workflows/deploy.yml`:
```yaml
name: Deploy JSHookMCP
on: [push]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: corepack enable && pnpm install
      - run: pnpm build
      - run: docker build -t jshookmcp .
      - run: echo "${{ secrets.DOCKER_PASSWORD }}" | docker login -u "${{ secrets.DOCKER_USERNAME }}" --password-stdin
      - run: docker tag jshookmcp your-registry/jshookmcp:latest
      - run: docker push your-registry/jshookmcp:latest
      - run: mcp-deploy --image your-registry/jshookmcp:latest --env-file .env
        env:
          MCP_DEPLOY_TOKEN: ${{ secrets.MCP_DEPLOY_TOKEN }}
```

---

## Environment Variables
| Variable               | Description                                  | Default       |
|------------------------|----------------------------------------------|---------------|
| `PORT`                 | Port to listen on                            | `3000`        |
| `LOG_LEVEL`            | Logging level (`debug`, `info`, `warn`, `error`) | `info`        |
| `OPENAI_API_KEY`       | API key for OpenAI                           |               |
| `OBFUSCATE_PRO_API_KEY` | API key for JavaScript Obfuscator Pro        |               |

---

## Troubleshooting
### Common Issues
1. **Port Already in Use**
   - Solution: Change the `PORT` environment variable or stop the conflicting service.

2. **Missing Dependencies**
   - Solution: Run `pnpm install` or rebuild the Docker container.

3. **Permission Denied**
   - Solution: Ensure the user has permissions to access the `.env` file and `dist/` directory.

4. **Docker Build Failures**
   - Solution: Check for platform-specific dependencies (e.g., `sharp` may require additional system libraries).

---

## References
- [Docker Documentation](https://docs.docker.com/)
- [Manufact Cloud Deployment Guide](https://docs.manufact.cloud/)
- [AWS ECS Documentation](https://docs.aws.amazon.com/ecs/)
- [Google Cloud Run Documentation](https://cloud.google.com/run/docs)

---