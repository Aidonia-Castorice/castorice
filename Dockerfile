# ========== Stage 1: Build frontend ==========
FROM node:20-alpine AS frontend-build
WORKDIR /app/vue3-project
COPY vue3-project/package*.json ./
RUN npm ci
COPY vue3-project/ ./
ARG VITE_API_BASE_URL=/api
ARG VITE_USE_REAL_API=true
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_USE_REAL_API=$VITE_USE_REAL_API
RUN npm run build

# ========== Stage 2: Production ==========
FROM node:20-alpine
WORKDIR /app

# Install build dependencies for native modules
RUN apk add --no-cache python3 make g++

# Copy backend package files and install dependencies
COPY express-project/package*.json ./
RUN npm ci --omit=dev 2>/dev/null || npm install --production

# Rebuild better-sqlite3 from source for Alpine compatibility
RUN npm rebuild better-sqlite3 --build-from-source 2>/dev/null || true

# Copy backend source
COPY express-project/ ./

# Copy built frontend
COPY --from=frontend-build /app/vue3-project/dist ./public

# Create data directory
RUN mkdir -p /app/data /app/uploads

# Environment
ENV NODE_ENV=production
ENV PORT=8080
ENV DB_TYPE=sqlite
ENV SQLITE_PATH=/app/data/app.db
ENV EMAIL_ENABLED=false
ENV IMAGE_UPLOAD_STRATEGY=imagehost
ENV IMAGEHOST_API_URL=https://api.xinyew.cn/api/360tc
ENV CORS_ORIGIN=*

EXPOSE 8080
CMD ["node", "app.js"]
