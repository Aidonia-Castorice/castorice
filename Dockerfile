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

# Install sqlite dependencies
RUN apk add --no-cache python3 make g++ && \
    cd /tmp && npm install better-sqlite3 --build-from-source && \
    cp -r /tmp/node_modules/better-sqlite3 /app/ 2>/dev/null || true

# Copy backend
COPY express-project/package*.json ./
RUN npm ci --omit=dev 2>/dev/null || npm install --production
COPY express-project/ ./

# Copy built frontend
COPY --from=frontend-build /app/vue3-project/dist ./public

# Create data directory
RUN mkdir -p /app/data /app/uploads

# Environment
ENV NODE_ENV=production
ENV PORT=3001
ENV DB_TYPE=sqlite
ENV SQLITE_PATH=/app/data/app.db
ENV EMAIL_ENABLED=false
ENV IMAGE_UPLOAD_STRATEGY=imagehost
ENV IMAGEHOST_API_URL=https://api.xinyew.cn/api/360tc
ENV CORS_ORIGIN=*

EXPOSE 3001

CMD ["node", "app.js"]
