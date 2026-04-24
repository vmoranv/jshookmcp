# Security labels
LABEL maintainer="security-team@example.com"
LABEL security.scan="passed"
LABEL org.opencontainers.image.source="https://github.com/example/repo"

FROM node:20-alpine AS builder
WORKDIR /app
ENV NODE_ENV=production

# Install build dependencies
RUN apk add --no-cache python3 make g++ && \
    apk update && apk upgrade

# Install pnpm
RUN npm install -g pnpm

# Install project dependencies
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source files and build
COPY . .
RUN pnpm build

# Remove build dependencies to reduce attack surface
RUN apk del python3 make g++ && \
    rm -rf /var/cache/apk/*

# Runtime stage
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# Security hardening: update packages and remove cache
RUN apk update && apk upgrade && \
    apk add --no-cache python3 curl && \
    rm -rf /var/cache/apk/* && \
    # Remove unnecessary system binaries
    rm -f /bin/sh /bin/ash /usr/bin/wget /usr/bin/curl && \
    # Create non-root user with specific UID/GID
    addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup -h /app -s /sbin/nologin

# Install pnpm
RUN npm install -g pnpm

# Copy built files from builder
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
COPY --from=builder --chown=appuser:appgroup /app/package.json ./
COPY --from=builder --chown=appuser:appgroup /app/pnpm-lock.yaml ./

# Install production dependencies only
RUN pnpm install --prod --frozen-lockfile

# Switch to non-root user
USER appuser

# Healthcheck
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Expose port
EXPOSE 3000

# Use exec form for proper signal handling
CMD ["pnpm", "start"]