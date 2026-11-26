FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 3000
# Provision the (emulated) AWS resources, then start the API + frontend.
CMD ["sh", "-c", "node database/provision.js --demo && node backend/server.js"]
