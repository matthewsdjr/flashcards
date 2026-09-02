# --- Etapa 1: compilar cliente y servidor ---
FROM node:24-alpine AS build
WORKDIR /app

# Los manifiestos primero, para aprovechar la cache de capas de Docker.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# El cliente se sirve desde la raiz del dominio.
ARG BASE_PATH=/
ENV BASE_PATH=$BASE_PATH
RUN npm run build && npm run build:server

# --- Etapa 2: solo lo necesario para correr ---
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server

# La base SQLite y los archivos subidos viven aca; se monta como volumen.
RUN mkdir -p /app/datos && chown -R node:node /app/datos
VOLUME ["/app/datos"]

ENV DATA_DIR=/app/datos \
    CLIENT_DIR=/app/dist \
    PORT=3000 \
    HOST=0.0.0.0

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3000/api/mazos/_ping >/dev/null || exit 1

CMD ["node", "dist-server/server/index.js"]
