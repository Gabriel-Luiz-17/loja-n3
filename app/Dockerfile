FROM node:20-alpine

ARG API_VERSION=1.0.0
ENV API_VERSION=${API_VERSION} \
    PORT=3000 \
    NODE_ENV=production

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY src/ ./src/

RUN addgroup -S appuser && adduser -S appuser -G appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 3000

CMD ["node", "src/server.js"]
