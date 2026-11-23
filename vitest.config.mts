// 자동 시험 도구(Vitest) 설정
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // 코드에서 쓰는 "@/..." 경로를 시험에서도 똑같이 쓰기 위한 설정 (tsconfig.json과 같은 규칙)
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    // 계산 코드(lib 폴더) 시험만 돌린다
    include: ["lib/**/*.test.ts"],
  },
});
