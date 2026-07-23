# Diss frontend: vite build served by nginx.
# Build context is the REPO ROOT (see docker-compose.yml).

FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY app/package.json app/package-lock.json ./
RUN npm ci
COPY app/ ./
RUN npm run build

FROM nginx:alpine
# Site config is bind-mounted from deploy/nginx.conf by docker-compose.yml.
COPY --from=build /src/dist /usr/share/nginx/html
EXPOSE 80
