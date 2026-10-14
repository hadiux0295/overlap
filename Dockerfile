# Runs as the unprivileged "node" user; the host starts it read-only with all capabilities dropped.
FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY public ./public
# saved example runs and the Qloo response cache are optional (both are git-ignored)
COPY example[s] ./examples
COPY cach[e] /cache
RUN mkdir -p /cache && chown -R node:node /cache
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8743 QLOO_CACHE_DIR=/cache
USER node
EXPOSE 8743
CMD ["node", "src/server.mjs"]
