# Single image: builds the React bundle, then runs the API which serves it.
# Same origin for app and API, so there is no CORS to configure and the session
# cookie is same-site by construction.
FROM node:22-alpine

WORKDIR /app

# Dependencies first, so a source change does not re-install node_modules.
COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev --no-audit --no-fund

COPY web/package*.json ./web/
RUN cd web && npm install --no-audit --no-fund

COPY web ./web
RUN cd web && npm run build

COPY server ./server
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

RUN apk add --no-cache postgresql16-client curl

ENV PORT=8140
EXPOSE 8140

HEALTHCHECK --interval=15s --timeout=4s --start-period=25s \
  CMD curl -fsS http://127.0.0.1:8140/api/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
