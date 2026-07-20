.PHONY: build run test clean tidy docker-build

build:
	go build -o openvelo-orchestrator main.go

run:
	go run main.go --project-id=1

test:
	go test -v ./...

tidy:
	go mod tidy

clean:
	rm -f openvelo-orchestrator

docker-build:
	docker build -t openvelo-orchestrator:linux .
