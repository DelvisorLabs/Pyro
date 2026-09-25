FROM node:26-alpine AS build
WORKDIR /app
# npm is only used to bootstrap the pinned package manager in the Node image.
RUN npm install --global pnpm@11.10.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/gateway/package.json apps/gateway/package.json
COPY apps/control-plane/package.json apps/control-plane/package.json
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/storage/package.json packages/storage/package.json
COPY packages/queue/package.json packages/queue/package.json
COPY packages/classifiers/package.json packages/classifiers/package.json
COPY packages/integrations/package.json packages/integrations/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY packages/cli/package.json packages/cli/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

FROM build AS production-deps
RUN pnpm --filter @pyro/gateway deploy --prod /prod/gateway \
  && pnpm --filter @pyro/control-plane deploy --prod /prod/control-plane

FROM node:26-alpine AS gateway
WORKDIR /app
ENV NODE_ENV=production
COPY --from=production-deps --chown=node:node /prod/gateway ./apps/gateway
COPY --from=build --chown=node:node /app/profiles ./profiles
USER node
EXPOSE 8080
CMD ["node", "apps/gateway/dist/server.js"]

FROM node:26-alpine AS control-plane
WORKDIR /app
ENV NODE_ENV=production
COPY --from=production-deps --chown=node:node /prod/control-plane ./apps/control-plane
COPY --from=build --chown=node:node /app/profiles ./profiles
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
