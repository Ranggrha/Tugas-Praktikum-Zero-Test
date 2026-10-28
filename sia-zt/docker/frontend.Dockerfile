FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
COPY apps/frontend/package*.json ./apps/frontend/
RUN npm install
COPY . .
EXPOSE 5173
CMD ["npm", "--workspace", "apps/frontend", "run", "dev", "--", "--host", "0.0.0.0"]
