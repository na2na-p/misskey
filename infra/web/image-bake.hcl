group "default" {
    targets = ["web"]
}

target "web" {
    dockerfile = "Dockerfile"
    platforms = ["linux/amd64", "linux/arm64"]
    cache-to = ["type=gha,mode=max,scope=misskey-na2na-docker-cache"]
    cache-from = ["type=gha,scope=misskey-na2na-docker-cache"]
}
