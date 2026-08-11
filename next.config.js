const path = require('path');

// [FIX] Turbopack workspace root를 모노레포 루트(ktb-BootcampChat)로 설정.
// __dirname은 apps/frontend를 가리키는데, Turbopack이 여기를 root로 착각하면
// next/package.json을 찾을 수 없다. 2단계 올라가서 실제 모노레포 루트를 가리켜야 함.
const workspaceRoot = path.resolve(__dirname, '../../');
const additionalDevOrigins = (process.env.DEV_ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 같은 LAN의 다른 기기에서 dev 서버(/_next 자산·HMR)에 접근하도록 허용한다. dev 전용이고
  // localhost는 Next가 항상 허용하므로 이 목록이 로컬 접속에 영향을 주지 않는다.
  // 패턴은 점 단위로 매칭돼서 사설망 IP는 네 칸을 다 써야 한다 — '192.168.*'는 매칭되지 않는다.
  allowedDevOrigins: [
    '192.168.*.*',
    '10.*.*.*',
    ...additionalDevOrigins
  ],
  transpilePackages: ['@vapor-ui/core', '@vapor-ui/icons'],
  turbopack: {
    root: workspaceRoot
  },
  // Docker 빌드를 위한 standalone 출력 모드 (개발 환경에는 영향 없음)
  output: 'standalone',
  outputFileTracingRoot: workspaceRoot
};

module.exports = nextConfig;
