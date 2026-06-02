FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY . ./
RUN go mod tidy && CGO_ENABLED=0 go build -ldflags="-s -w" -o /tuya-cameras-dashboard .

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=build /tuya-cameras-dashboard /app/tuya-cameras-dashboard
USER nobody
EXPOSE 8080
ENTRYPOINT ["/app/tuya-cameras-dashboard"]
