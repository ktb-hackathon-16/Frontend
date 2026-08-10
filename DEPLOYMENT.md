# Frontend 배포 가이드

이 repo는 프론트엔드 전용 repo입니다. 운영 실행 기준은 Docker 이미지와
`docker-compose.yaml`입니다.

주의: Next.js의 `NEXT_PUBLIC_*` 값은 클라이언트 번들에 들어가므로 **이미지 빌드
시점 값**이 중요합니다. EC2의 `frontend-app.env`는 컨테이너 런타임 기준을
정리하는 용도이고, 새 이미지를 만들 때도 같은 값을 build arg로 넣어야 합니다.

## 구조

- 로컬 개발 env: `.env.local`
- 로컬/빌드용 production env: `.env.production`
- 운영 env 예시: `frontend-app.env.example`
- EC2 운영 env: `/etc/ktb/frontend-app.env`
- EC2 compose: `/home/ubuntu/ktb-chat-frontend/docker-compose.yaml`
- 현재 운영 이미지: `youngjin179/ktb-frontend:87c9841-fe-fix3`

운영에서는 로컬 `.env.local`, `.env.production`을 서버에 복사하지 않습니다.

## 1. Docker 이미지 빌드

```bash
cd apps/frontend
docker build \
  --build-arg NEXT_PUBLIC_API_URL=http://goorm-ktb-016.goorm.team/api \
  --build-arg NEXT_PUBLIC_SOCKET_URL=http://goorm-ktb-016.goorm.team \
  -t youngjin179/ktb-frontend:새태그 .
```

## 2. Docker 이미지 push

```bash
docker push youngjin179/ktb-frontend:새태그
```

이미지 태그를 바꿨다면 `docker-compose.yaml`의 기본 이미지 또는 실행 시
`FRONTEND_IMAGE` 값을 같이 바꿉니다.

## 3. EC2 운영 env 준비

Frontend EC2에서 최초 1회만 설정합니다.

```bash
sudo mkdir -p /etc/ktb
sudo nano /etc/ktb/frontend-app.env
sudo chown root:root /etc/ktb/frontend-app.env
sudo chmod 600 /etc/ktb/frontend-app.env
```

필수 키는 `frontend-app.env.example`을 기준으로 채웁니다.

## 4. compose 파일 배포

로컬에서 실행합니다.

```bash
cd apps/frontend
make deploy-compose DEPLOY_SERVERS=ktb-frontend
```

`make deploy-compose`는 아래 명령을 짧게 감싼 것입니다.

```bash
rsync -az docker-compose.yaml ktb-frontend:/home/ubuntu/ktb-chat-frontend/
```

## 5. EC2에서 컨테이너 재실행

로컬에서 실행합니다.

```bash
cd apps/frontend
make compose-up-servers DEPLOY_SERVERS=ktb-frontend
```

`make compose-up-servers`는 EC2에서 아래 명령을 실행하는 wrapper입니다.

```bash
cd /home/ubuntu/ktb-chat-frontend
sudo docker-compose -f docker-compose.yaml up -d
```

이미지 태그를 바꿔서 실행하려면:

```bash
FRONTEND_IMAGE=youngjin179/ktb-frontend:새태그 \
make compose-up-servers DEPLOY_SERVERS=ktb-frontend
```

## 6. 확인

Frontend EC2에서 확인합니다.

```bash
sudo docker ps --filter name=frontend-app
curl -I http://localhost:3000
```

정상 포트:

```text
0.0.0.0:3000->3000/tcp
```

## 왜 make를 쓰나?

`make`는 필수가 아닙니다. 긴 SSH/rsync/docker-compose 명령을 짧게 부르는
wrapper입니다.

- 이미지를 새로 만들 때: `docker build`, `docker push`
- 서버에서 실행할 때: `docker-compose up -d`
- 반복 명령을 줄이고 싶을 때: `make deploy-compose`, `make compose-up-servers`
