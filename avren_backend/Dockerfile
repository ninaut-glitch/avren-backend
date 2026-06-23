FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
RUN ls -la dist/ || echo "dist vazio"
EXPOSE 3000
CMD ["node", "dist/main.js"]
