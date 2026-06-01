FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY . ./
RUN go mod tidy && CGO_ENABLED=0 go build -ldflags="-s -w" -o /mira-cameras .

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=build /mira-cameras /app/mira-cameras
USER nobody
EXPOSE 8080
ENTRYPOINT ["/app/mira-cameras"]
