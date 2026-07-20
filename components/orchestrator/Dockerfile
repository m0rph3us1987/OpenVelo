# Build stage
FROM golang:alpine AS builder
WORKDIR /app

RUN apk add --no-cache git

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o openvelo-orchestrator main.go

# Production stage
FROM alpine:latest
WORKDIR /app

RUN apk add --no-cache ca-certificates docker-cli tzdata

COPY --from=builder /app/openvelo-orchestrator /app/openvelo-orchestrator

ENTRYPOINT ["/app/openvelo-orchestrator"]
