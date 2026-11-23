# The map viewer as a web server that needs nothing beside it.
#
# The image holds the games' own files, taken from game-data/, which
# `npm run extract` makes from the installed games and git ignores. Build it
# after running that. The image is for your own use: it must not be pushed
# anywhere others can pull it from.
#
#   npm run extract
#   docker build -t historyline-viewer .
#   docker run --rm -p 5914:80 historyline-viewer
#
# or `docker compose up --build`. The viewer is then at http://localhost:5914.

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
# What the viewer's pages are built from; the games' files take no part in the build.
COPY index.html bi2.html vite.config.ts tsconfig.json ./
COPY src src
COPY tools tools
COPY maps maps
RUN npm run build

FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
COPY game-data /usr/share/nginx/html/game
EXPOSE 80
