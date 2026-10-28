FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
COPY apps/gateway/package*.json ./apps/gateway/
COPY packages/shared ./packages/shared
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "--workspace", "apps/gateway", "run", "start"]
