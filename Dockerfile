# syntax=docker/dockerfile:1
# Noto — kho ghi chú markdown, phục vụ tại root của noto.lazybutts.com.
# Runtime là server Node nhỏ (server/server.js): vừa trả bản build tĩnh, vừa mở
# /api/vault cho "kho trên máy chủ" — ghi chú là file .md thật trong volume
# /data/vault trên Mac mini, nên mọi thiết bị mở cùng một kho và dữ liệu được
# sao lưu như các app khác. Người dùng vẫn chọn được kho trong trình duyệt hoặc
# thư mục trên máy mình trong phần Cài đặt.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production NOTO_VAULT_DIR=/data/vault PORT=8080
COPY --from=build /app/dist ./dist
COPY server ./server
EXPOSE 8080
CMD ["node", "server/server.js"]
