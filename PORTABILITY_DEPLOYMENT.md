# JSHookMCP Portability and Deployment Guide

## Portability
JSHookMCP is designed to be **portable** across environments, including:
- **Local development** (Linux, macOS, Windows)
- **Docker containers**
- **Cloud platforms** (Manufact Cloud, AWS, Google Cloud)
- **Bare-metal/VPS**

### Key Features for Portability
1. **Environment Variables**: All configurations are managed via `.env`.
2. **Platform-Agnostic Dependencies**: Avoids system-specific binaries where possible.
3. **Transport Flexibility**: Supports both **HTTP** and **stdio** for tool execution.
4. **Containerization**: Docker image for consistent deployments.

---

## Deployment
### 1. Local Deployment
#### Prerequisites
- Node.js v20+
- pnpm

#### Steps
1. Install dependencies:
   ```bash
   pnpm install
   ```
2. Configure environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```
3. Start the server:
   ```bash
   pnpm start
   ```

---

### 2. Docker Deployment
#### Prerequisites
- Docker or Podman

#### Steps
1. Build the Docker image:
   ```bash
   docker build -t jshookmcp .
   ```
2. Run the container:
   ```bash
   docker run -p 3000:3000 --env-file .env jshookmcp
   ```

#### Troubleshooting
- **Network Issues**: If using Podman, switch to `iptables-legacy`:
  ```bash
  sudo update-alternatives --set iptables /usr/sbin/iptables-legacy
  sudo update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy
  ```
- **Permission Denied**: Ensure the user has permissions to access `.env` and `dist/`.

---

### 3. Cloud Deployment
#### Manufact Cloud
1. Push the Docker image to a registry:
   ```bash
   docker tag jshookmcp your-registry/jshookmcp:latest
   docker push your-registry/jshookmcp:latest
   ```
2. Deploy using the `mcp-deploy` CLI:
   ```bash
   mcp-deploy --image your-registry/jshookmcp:latest --env-file .env
   ```

#### AWS (ECS/Fargate)
1. Push the Docker image to Amazon ECR:
   ```bash
aws ecr get-login-password | docker login --username AWS --password-stdin your-account-id.dkr.ecr.your-region.amazonaws.com
   docker tag jshookmcp:latest your-account-id.dkr.ecr.your-region.amazonaws.com/jshookmcp:latest
   docker push your-account-id.dkr.ecr.your-region.amazonaws.com/jshookmcp:latest
   ```
2. Deploy using AWS ECS or Fargate.

#### Google Cloud (Cloud Run)
1. Push the Docker image to Google Container Registry:
   ```bash
docker tag jshookmcp gcr.io/your-project-id/jshookmcp
   docker push gcr.io/your-project-id/jshookmcp
   ```
2. Deploy using Cloud Run:
   ```bash
gcloud run deploy jshookmcp --image gcr.io/your-project-id/jshookmcp --platform managed --region your-region --allow-unauthenticated
   ```

---

### 4. CI/CD (GitHub Actions)
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
   - Solution: Use `--no-cache` flag or switch to `iptables-legacy`.

---

## References
- [Docker Documentation](https://docs.docker.com/)
- [Manufact Cloud Deployment Guide](https://docs.manufact.cloud/)
- [AWS ECS Documentation](https://docs.aws.amazon.com/ecs/)
- [Google Cloud Run Documentation](https://cloud.google.com/run/docs)

---