export type MapTeamLogoPosition = {
  x: number;
  y: number;
};

// Percent coordinates within the map image (0-100), tuned for first-pass placement.
export const TEAM_MAP_LOGO_POSITIONS: Record<string, MapTeamLogoPosition> = {
  alc: { x: 28.8, y: 24.8 },
  val: { x: 26.6, y: 35.8 },
  luf: { x: 77.4, y: 34.4 },
  hui: { x: 16.9, y: 31.2 },
  ara: { x: 52.3, y: 42.4 },
  des: { x: 58.6, y: 29.6 },
  suk: { x: 60.1, y: 35.2 },
  gar: { x: 69.2, y: 30.8 },
  gra: { x: 63.9, y: 45.1 },
  tru: { x: 49.2, y: 53.4 },
  caf: { x: 43.7, y: 48.1 },
  rag: { x: 71.2, y: 40.5 },
  win: { x: 77.5, y: 46.8 },
  aub: { x: 82.8, y: 39.7 },
  dwi: { x: 83.3, y: 57.8 },
  hou: { x: 75.2, y: 49.5 },
  ock: { x: 24.5, y: 29.3 },
  bal: { x: 31.5, y: 53.8 },
  fes: { x: 56.3, y: 56.1 },
  urb: { x: 40.5, y: 34.7 },
  sin: { x: 34.5, y: 44.4 },
  loy: { x: 21.5, y: 61.2 },
  niy: { x: 42.8, y: 73.8 },
  ars: { x: 15.6, y: 70.5 },
  der: { x: 80.8, y: 61.5 },
  rei: { x: 68.7, y: 52.1 },
  fey: { x: 86.7, y: 48.8 },
  cal: { x: 64.1, y: 27.9 },
  sta: { x: 30.1, y: 60.9 },
  bra: { x: 87.2, y: 55.2 },
  geb: { x: 74.2, y: 61.7 },
  and: { x: 82.2, y: 33.7 },
};
