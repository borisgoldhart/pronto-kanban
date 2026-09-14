# End-state container (ECS Fargate in the Pronto AWS account). The same code runs
# on Vercel in the prototype; nothing here is Vercel-specific.
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY web/package.json web/
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/server ./server
COPY --from=build /app/pronto-base ./pronto-base
COPY --from=build /app/web/dist ./web/dist
EXPOSE 8791
CMD ["node", "server/index.js"]
