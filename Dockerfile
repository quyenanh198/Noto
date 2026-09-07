# syntax=docker/dockerfile:1
# Noto — kho ghi chú markdown (local-first) phục vụ dưới /noto/ trong hub
# Lazybutts (caddy định tuyến tại chat.lazybutts.com/noto/*). Vite build với
# VITE_BASE_PATH nên mọi asset trỏ đúng sub-path; dữ liệu nằm ở IndexedDB của
# trình duyệt hoặc thư mục người dùng chọn, container không giữ state.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV VITE_BASE_PATH=/noto/
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html/noto
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
