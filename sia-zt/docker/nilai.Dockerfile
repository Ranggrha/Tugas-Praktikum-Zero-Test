FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
COPY apps/service-nilai/package*.json ./apps/service-nilai/
COPY packages/shared ./packages/shared
RUN npm install
COPY . .
EXPOSE 3001
CMD ["npm", "--workspace", "apps/service-nilai", "run", "start"]
