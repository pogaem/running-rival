// 접속한 기기·브라우저 알아보기 (위치 켜는 방법을 환경에 맞게 안내하려고 쓴다)
// 브라우저가 알려 주는 접속 정보(User-Agent) 글만 보고 어림잡는다. 틀릴 수 있어서 안내 화면에서 직접 바꿀 수도 있게 한다.

export type DeviceEnv = "iphone-safari" | "samsung-internet" | "android-chrome" | "other";

export function detectDeviceEnv(userAgent: string): DeviceEnv {
  const ua = userAgent.toLowerCase();
  const isIos = /iphone|ipad|ipod/.test(ua) || (ua.includes("macintosh") && ua.includes("mobile"));
  if (isIos) return "iphone-safari"; // 아이폰의 크롬·네이버 앱도 같은 위치 설정을 따른다
  if (ua.includes("samsungbrowser")) return "samsung-internet";
  if (ua.includes("android")) return "android-chrome";
  return "other";
}

export const ENV_LABEL: Record<DeviceEnv, string> = {
  "iphone-safari": "아이폰",
  "samsung-internet": "삼성 인터넷",
  "android-chrome": "안드로이드 크롬",
  other: "컴퓨터·기타",
};

/** 위치 권한이 꺼져 있을 때 켜는 방법 (단계별) */
export const LOCATION_GUIDE: Record<DeviceEnv, string[]> = {
  "iphone-safari": [
    "설정 → 개인정보 보호 및 보안 → 위치 서비스를 켠다",
    "아래쪽 Safari 웹사이트 → '앱을 사용하는 동안'으로 바꾼다",
    "또는 주소창 왼쪽 'aA' → 웹사이트 설정 → 위치 → 허용",
    "돌아와서 '다시 확인하기'를 누른다",
  ],
  "samsung-internet": [
    "주소창 왼쪽 자물쇠(또는 사이트 정보) 아이콘을 누른다",
    "권한 → 위치 → 허용으로 바꾼다",
    "안 보이면 설정 → 애플리케이션 → 삼성 인터넷 → 권한 → 위치 → 허용",
    "돌아와서 '다시 확인하기'를 누른다",
  ],
  "android-chrome": [
    "주소창 왼쪽 자물쇠 아이콘 → 권한 → 위치 → 허용",
    "안 보이면 설정 → 애플리케이션 → Chrome → 권한 → 위치 → 허용",
    "돌아와서 '다시 확인하기'를 누른다",
  ],
  other: ["브라우저 주소창 왼쪽 아이콘 → 사이트 설정 → 위치 → 허용", "새로 고침한 뒤 '다시 확인하기'를 누른다"],
};
