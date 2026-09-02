# --- Etapa 1: build ---
FROM node:22-alpine AS build
WORKDIR /app

# Se copian primero los manifiestos para aprovechar la cache de capas.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# BASE_PATH permite servir la app desde un subdirectorio, ej: /flashcards/
ARG BASE_PATH=/
ENV BASE_PATH=$BASE_PATH
RUN npm run build

# --- Etapa 2: servidor estatico ---
FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
