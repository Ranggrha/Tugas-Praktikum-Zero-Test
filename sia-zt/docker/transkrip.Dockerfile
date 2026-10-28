FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
COPY apps/service-transkrip/package*.json ./apps/service-transkrip/
COPY packages/shared ./packages/shared
RUN npm install
COPY . .
EXPOSE 3002
CMD ["npm", "--workspace", "apps/service-transkrip", "run", "start"]
