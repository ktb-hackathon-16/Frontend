# Frontend 배포 가이드

운영 배포는 **latest 태그를 쓰지 않고**, 로컬에서 태그가 붙은 Docker 이미지를
빌드한 뒤 Docker Hub에 push하고 EC2에서 pull/run 합니다.

Next.js의 `NEXT_PUBLIC_*` 값은 브라우저 번들에 **빌드 시점에 포함**됩니다.
따라서 이미지 빌드 시 ALB public DNS를 넣어야 하며, `10.0.x.x` private IP나
직접 포트는 넣지 않습니다.

## 기본 정보

- Docker Hub image: `youngjin179/ktb-frontend:<TAG>`
- Frontend EC2: `10.0.2.228`
- ALB: `http://public-ktb-alb-974381789.ap-northeast-2.elb.amazonaws.com`
- EC2 env: `/etc/ktb/frontend-app.env`
- EC2 compose: `/home/ubuntu/ktb-chat-frontend/docker-compose.yaml`

## 1. 태그 설정

Frontend repo root에서 실행합니다.

```bash
export DOCKER_NS=youngjin179
export TAG=$(git rev-parse --short HEAD)-smoke1
export ALB_URL=http://public-ktb-alb-974381789.ap-northeast-2.elb.amazonaws.com
```

예:

```text
youngjin179/ktb-frontend:abc1234-smoke1
```

## 2. Docker Hub 로그인

```bash
docker login
```

## 3. 이미지 빌드/푸시

```bash
docker build \
  --build-arg NEXT_PUBLIC_API_URL=$ALB_URL \
  --build-arg NEXT_PUBLIC_SOCKET_URL=$ALB_URL \
  -t $DOCKER_NS/ktb-frontend:$TAG \
  .

docker push $DOCKER_NS/ktb-frontend:$TAG
```

## 4. EC2 env 확인

Frontend EC2에서 `/etc/ktb/frontend-app.env`를 관리합니다. 로컬 `.env.local`,
`.env.production`은 서버에 복사하지 않습니다.

필수 ALB URL:

```env
NEXT_PUBLIC_API_URL=http://public-ktb-alb-974381789.ap-northeast-2.elb.amazonaws.com
NEXT_PUBLIC_SOCKET_URL=http://public-ktb-alb-974381789.ap-northeast-2.elb.amazonaws.com
```

확인:

```bash
sudo awk -F= '/^(NEXT_PUBLIC_API_URL|NEXT_PUBLIC_SOCKET_URL)=/ {print $1}' /etc/ktb/frontend-app.env
```

## 5. compose 파일 배포

```bash
make deploy-compose DEPLOY_SERVERS=ktb-frontend
```

`make deploy-compose`는 아래 명령의 wrapper입니다.

```bash
rsync -az docker-compose.yaml ktb-frontend:/home/ubuntu/ktb-chat-frontend/
```

## 6. EC2에서 새 이미지 실행

```bash
FRONTEND_IMAGE=$DOCKER_NS/ktb-frontend:$TAG \
make compose-up-servers DEPLOY_SERVERS=ktb-frontend
```

직접 EC2에서 실행하려면:

```bash
export TAG=<실제_TAG>
sudo docker pull youngjin179/ktb-frontend:$TAG

cd /home/ubuntu/ktb-chat-frontend
sudo env FRONTEND_IMAGE=youngjin179/ktb-frontend:$TAG \
  docker-compose -f docker-compose.yaml up -d
```

## 7. 확인

```bash
sudo docker ps --filter name=frontend-app
curl -I http://localhost:3000
sudo docker logs -f frontend-app
```

## make는 왜 쓰나?

`make`는 Docker를 대체하지 않습니다. SSH/rsync/docker-compose 명령을 짧게
부르는 wrapper입니다.

- 이미지 생성: `docker build`
- 이미지 업로드: `docker push`
- EC2 실행: `docker-compose up -d`
- 반복 명령 단축: `make deploy-compose`, `make compose-up-servers`
