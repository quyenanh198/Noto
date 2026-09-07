# syntax=docker/dockerfile:1
# Noto — kho ghi chú markdown (local-first) phục vụ tại root của
# noto.lazybutts.com (caddy trong hub Lazybutts định tuyến host này tới đây).
# Build mặc định base `/` nên không cần VITE_BASE_PATH; dữ liệu nằm ở IndexedDB
# của trình duyệt hoặc thư mục người dùng chọn, container không giữ state.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
