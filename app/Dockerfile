FROM node:26-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Tests run as part of every image build, so CI fails before a broken image ships
FROM base AS test
COPY . .
RUN npm test && touch /tmp/tests-passed

FROM base AS runtime
RUN apk add --no-cache curl
COPY --from=test /tmp/tests-passed /tmp/tests-passed
COPY . .
ENV NODE_ENV=production DATA_DIR=/app/data
EXPOSE 3000
CMD ["node", "main.js"]
