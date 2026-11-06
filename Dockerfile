# Ontodata API + UI in one image. The API serves the built UI on port 4000.
# Build: docker build -t ontodata-app .   (or: npm run stack:up)

FROM node:22-bookworm-slim AS build
WORKDIR /app

# Install dependencies first so they're cached across source changes.
COPY backend/package.json backend/package-lock.json backend/
RUN npm --prefix backend ci
COPY frontend/package.json frontend/package-lock.json frontend/
RUN npm --prefix frontend ci

COPY backend backend
COPY frontend frontend
RUN npm --prefix backend run build \
 && npm --prefix frontend run build \
 && npm --prefix backend prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=4000 \
    DATA_DIR=/data \
    UI_DIR=/app/frontend/dist \
    ONTOP_INPUT_DIR=/ontop-input
WORKDIR /app/backend

COPY --from=build /app/backend/package.json ./
COPY --from=build /app/backend/node_modules ./node_modules
COPY --from=build /app/backend/dist ./dist
COPY --from=build /app/frontend/dist /app/frontend/dist

# State and generated Ontop files live on volumes; create them owned by the unprivileged user.
RUN mkdir -p /data /ontop-input && chown node:node /data /ontop-input
USER node

EXPOSE 4000
CMD ["node", "dist/index.js"]
