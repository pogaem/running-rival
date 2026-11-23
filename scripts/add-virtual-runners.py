# 가상 러너를 빠른 쪽(3:00)부터 느린 쪽(20:00)까지 늘리는 일회용 스크립트 (이미 있는 01~09번은 그대로 둔다)
# 모양(4구간 페이스 비율)은 기존과 같은 네 가지를 돌아가며 쓰고, 기록은 250m마다 한 점이다.
import json, re
root = "/Users/pogaem/Desktop/my-app/"
path = root + "data/virtual-runners.json"
runners = json.load(open(path))
have = {r["id"] for r in runners}
shapes = [
    ("일정형", [1.00, 1.00, 1.00, 1.00], "시계추"),
    ("후반 스퍼트형", [1.08, 1.03, 0.97, 0.92], "여우"),
    ("초반 질주형", [0.90, 0.97, 1.04, 1.09], "토끼"),
    ("중반 처짐형", [0.96, 1.07, 1.06, 0.91], "거북"),
]
paces = list(range(150, 1261, 15))  # 3:00~20:00 밖 양끝까지 포함해 15초 간격으로 (기존 01~09번과 함께 쓴다)
elev = [0, 5, 10, 15, 20, 25, 30, 40, 45, 60, None]
names = {}
for i, pace in enumerate(paces):
    n = 10 + i
    rid = f"가상러너-{n:02d}"
    if rid in have:
        continue
    _, ratios, animal = shapes[i % 4]
    mean = sum(ratios) / 4
    ratios = [1 + (x / mean - 1) * 0.5 for x in ratios]  # 모양을 기존의 절반만 기울여, 1km·3km 구간만 봐도 평균 페이스에서 크게 벗어나지 않게 한다  # 평균 페이스가 정확히 pace가 되도록
    points = [{"t": 0, "d": 0}]
    t = 0.0
    for d in range(250, 5001, 250):
        seg = (d - 1) * 4 // 5000 if d < 5000 else 3
        t += 0.25 * pace * ratios[seg]
        points.append({"t": round(t, 1), "d": d})
    runners.append({"id": rid, "source": "virtual", "registrationOrder": n, "completedDistanceM": 5000,
                    "totalElevationGainM": elev[i % len(elev)], "points": points})
    names[rid] = f"{pace // 60}:{pace % 60:02d} {animal}"
json.dump(runners, open(path, "w"), ensure_ascii=False, indent=2)
f = root + "lib/runner-names.ts"
s = open(f).read()
add = "".join(f'  "{k}": "{v}",\n' for k, v in names.items())
s = s.replace('  "가상러너-09": "꾸준한 곰",\n', '  "가상러너-09": "꾸준한 곰",\n' + add)
open(f, "w").write(s)
print(len(names), "명 추가")
