FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/gateway/package.json apps/gateway/package.json
COPY apps/control-plane/package.json apps/control-plane/package.json
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/storage/package.json packages/storage/package.json
COPY packages/queue/package.json packages/queue/package.json
COPY packages/classifiers/package.json packages/classifiers/package.json
COPY packages/sdk/package.json packages/sdk/package.json
RUN npm ci
COPY . .
RUN npm run build

FROM build AS production-deps
RUN npm prune --omit=dev

FROM node:26-alpine AS gateway
WORKDIR /app
ENV NODE_ENV=production
COPY --from=production-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/apps/gateway/package.json ./apps/gateway/package.json
COPY --from=build --chown=node:node /app/apps/gateway/dist ./apps/gateway/dist
COPY --from=build --chown=node:node /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build --chown=node:node /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build --chown=node:node /app/packages/storage/package.json ./packages/storage/package.json
COPY --from=build --chown=node:node /app/packages/storage/dist ./packages/storage/dist
COPY --from=build --chown=node:node /app/packages/queue/package.json ./packages/queue/package.json
COPY --from=build --chown=node:node /app/packages/queue/dist ./packages/queue/dist
COPY --from=build --chown=node:node /app/packages/classifiers/package.json ./packages/classifiers/package.json
COPY --from=build --chown=node:node /app/packages/classifiers/dist ./packages/classifiers/dist
USER node
EXPOSE 8080
CMD ["node", "apps/gateway/dist/server.js"]

FROM node:26-alpine AS control-plane
WORKDIR /app
ENV NODE_ENV=production
COPY --from=production-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/apps/control-plane/package.json ./apps/control-plane/package.json
COPY --from=build --chown=node:node /app/apps/control-plane/dist ./apps/control-plane/dist
COPY --from=build --chown=node:node /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build --chown=node:node /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build --chown=node:node /app/packages/storage/package.json ./packages/storage/package.json
COPY --from=build --chown=node:node /app/packages/storage/dist ./packages/storage/dist
USER node
EXPOSE 8081
CMD ["node", "apps/control-plane/dist/server.js"]

FROM nginx:1.31-alpine AS dashboard
COPY apps/dashboard/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/dashboard/dist /usr/share/nginx/html
RUN sed -i 's|^pid .*;|pid /tmp/nginx.pid;|' /etc/nginx/nginx.conf \
  && sed -i '/^user  nginx;/d' /etc/nginx/nginx.conf \
  && chown -R nginx:nginx /var/cache/nginx /usr/share/nginx/html /etc/nginx/conf.d
USER nginx
EXPOSE 8080
ENTRYPOINT ["nginx", "-g", "daemon off;"]
