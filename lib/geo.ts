// 위치 계산 도구: 두 위치 사이의 거리 (참가자 기록 변환, 데모 경로, GPS 보정이 함께 쓴다)

/** 위도·경도로 나타낸 위치 */
export type GeoPoint = { lat: number; lon: number };

/** 지구 반지름(미터). 지구를 둥근 공으로 보고 계산한다 */
export const EARTH_RADIUS_M = 6371000;

/** 위도(남북) 1도의 거리(미터). 경도 1도는 여기에 cos(위도)를 곱한다 */
export const METERS_PER_DEGREE_LAT = (Math.PI / 180) * EARTH_RADIUS_M;

/** 두 위치 사이의 거리(미터) */
export function distanceBetweenM(a: GeoPoint, b: GeoPoint): number {
  const toRad = (degree: number) => (degree * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}
