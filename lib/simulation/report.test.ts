// 시뮬레이션 숫자를 화면에 찍어 보는 실행기. 평소 시험에서는 건너뛴다.
// 실행: SIM=1 npx vitest run lib/simulation/report.test.ts
import { describe, it } from "vitest";
import { runSimulation } from "./rival-sim";

describe.skipIf(!process.env.SIM)("시뮬레이션 결과 출력", () => {
  it("흔드는 정도별로 두 방식을 비교한다", () => {
    const settings = [
      { paceJitter: 0.02, shapeJitter: 0.03 },
      { paceJitter: 0.03, shapeJitter: 0.04 },
      { paceJitter: 0.05, shapeJitter: 0.06 },
    ];
    for (const s of settings) {
      const r = runSimulation({ trials: 1000, ...s });
      const f = (x: number, d = 2) => x.toFixed(d);
      console.log(
        `흔들기 페이스 ${s.paceJitter} 모양 ${s.shapeJitter} | 경기 ${r.races}개 | ` +
          `페이스만: 평균 역전 ${f(r.pacesOnly.meanReversals)}, 역전 있는 경기 ${f(r.pacesOnly.shareWithReversal * 100, 1)}%, 페이스차 ${f(r.pacesOnly.meanAbsPaceDiff, 1)}초/km | ` +
          `역전 예측: 평균 역전 ${f(r.prediction.meanReversals)}, 역전 있는 경기 ${f(r.prediction.shareWithReversal * 100, 1)}%, 페이스차 ${f(r.prediction.meanAbsPaceDiff, 1)}초/km | ` +
          `다른 상대 고른 비율 ${f(r.shareDifferentOpponent * 100, 1)}% | 차이(예측-페이스만) ${f(r.meanDifference, 3)} ± ${f(r.standardError, 3)} | ` +
          `다른 상대만(${r.onlyDifferent.races}경기): 페이스만 ${f(r.onlyDifferent.pacesOnly)} vs 예측 ${f(r.onlyDifferent.prediction)}`,
      );
    }
  });
});
