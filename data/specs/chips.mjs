// SoC / チップ マスター辞書（公式発表値・一般に確認されている値のみ収録。不明な項目は省略 = UI では自動非表示）
// cpu / gpu / ne / bw は「構成により」複数ある場合は ' / ' で併記する。
// ai: Apple Intelligence 対応チップかどうか（iPhone は A17 Pro 以降、Mac/iPad は M1 以降）
export const CHIPS = {
  // ---- A シリーズ (iPhone / iPad) ----
  A4: { process: '45nm', cpu: '1コア', gpu: 'PowerVR SGX535' },
  A5: { process: '45nm → 32nm', cpu: '2コア', gpu: 'PowerVR SGX543MP2' },
  A5X: { process: '45nm', cpu: '2コア', gpu: 'PowerVR SGX543MP4' },
  A6: { process: '32nm', cpu: '2コア', gpu: 'PowerVR SGX543MP3' },
  A6X: { process: '32nm', cpu: '2コア', gpu: 'PowerVR SGX554MP4' },
  A7: { process: '28nm', cpu: '2コア（64bit）', gpu: 'PowerVR G6430' },
  A8: { process: '20nm', cpu: '2コア', gpu: 'PowerVR GX6450' },
  A8X: { process: '20nm', cpu: '3コア', gpu: 'PowerVR GXA6850 (8クラスタ)' },
  A9: { process: '14nm (Samsung) / 16nm (TSMC)', cpu: '2コア', gpu: 'PowerVR GT7600' },
  A9X: { process: '16nm', cpu: '2コア', gpu: 'PowerVR 12クラスタ' },
  A10: { process: '16nm', cpu: '4コア（高性能2＋高効率2）', gpu: '6コア' },
  A10X: { process: '10nm', cpu: '6コア（高性能3＋高効率3）', gpu: '12コア' },
  A11: { process: '10nm', cpu: '6コア（高性能2＋高効率4）', gpu: '3コア（Apple設計）', ne: '2コア（0.6 TOPS）' },
  A12: { process: '7nm', cpu: '6コア（高性能2＋高効率4）', gpu: '4コア', ne: '8コア（5 TOPS）' },
  A12X: { process: '7nm', cpu: '8コア（高性能4＋高効率4）', gpu: '7コア', ne: '8コア（5 TOPS）' },
  A12Z: { process: '7nm', cpu: '8コア（高性能4＋高効率4）', gpu: '8コア', ne: '8コア（5 TOPS）' },
  A13: { process: '7nm 第2世代', cpu: '6コア（高性能2＋高効率4）', gpu: '4コア', ne: '8コア（6 TOPS）' },
  A14: { process: '5nm', cpu: '6コア（高性能2＋高効率4）', gpu: '4コア', ne: '16コア（11 TOPS）' },
  A15: { process: '5nm 第2世代', cpu: '6コア（高性能2＋高効率4）', gpu: '4コア / 5コア', ne: '16コア（15.8 TOPS）' },
  A16: { process: '4nm', cpu: '6コア（高性能2＋高効率4）', gpu: '5コア', ne: '16コア（17 TOPS）' },
  'A17 Pro': { process: '3nm', cpu: '6コア（高性能2＋高効率4）', gpu: '6コア', ne: '16コア（35 TOPS）', ai: true },
  A18: { process: '3nm 第2世代', cpu: '6コア（高性能2＋高効率4）', gpu: '4コア / 5コア', ne: '16コア（35 TOPS）', ai: true },
  'A18 Pro': { process: '3nm 第2世代', cpu: '6コア（高性能2＋高効率4）', gpu: '5コア / 6コア', ne: '16コア（35 TOPS）', ai: true },
  A19: { process: '3nm 第3世代', cpu: '6コア（高性能2＋高効率4）', gpu: '5コア', ne: '16コア', ai: true },
  'A19 Pro': { process: '3nm 第3世代', cpu: '6コア（高性能2＋高効率4）', gpu: '5コア / 6コア', ne: '16コア', ai: true },

  // ---- M シリーズ (Mac / iPad) ----
  M1: { process: '5nm', cpu: '8コア（高性能4＋高効率4）', gpu: '7コア / 8コア', ne: '16コア（11 TOPS）', bw: '68.25GB/s', ai: true },
  'M1 Pro': { process: '5nm', cpu: '8コア（高性能6＋高効率2） / 10コア（高性能8＋高効率2）', gpu: '14コア / 16コア', ne: '16コア（11 TOPS）', bw: '200GB/s', ai: true },
  'M1 Max': { process: '5nm', cpu: '10コア（高性能8＋高効率2）', gpu: '24コア / 32コア', ne: '16コア（11 TOPS）', bw: '400GB/s', ai: true },
  'M1 Ultra': { process: '5nm（UltraFusion）', cpu: '20コア（高性能16＋高効率4）', gpu: '48コア / 64コア', ne: '32コア（22 TOPS）', bw: '800GB/s', ai: true },
  M2: { process: '5nm 第2世代', cpu: '8コア（高性能4＋高効率4）', gpu: '8コア / 10コア', ne: '16コア（15.8 TOPS）', bw: '100GB/s', ai: true },
  'M2 Pro': { process: '5nm 第2世代', cpu: '10コア（高性能6＋高効率4） / 12コア（高性能8＋高効率4）', gpu: '16コア / 19コア', ne: '16コア（15.8 TOPS）', bw: '200GB/s', ai: true },
  'M2 Max': { process: '5nm 第2世代', cpu: '12コア（高性能8＋高効率4）', gpu: '30コア / 38コア', ne: '16コア（15.8 TOPS）', bw: '400GB/s', ai: true },
  'M2 Ultra': { process: '5nm 第2世代（UltraFusion）', cpu: '24コア（高性能16＋高効率8）', gpu: '60コア / 76コア', ne: '32コア（31.6 TOPS）', bw: '800GB/s', ai: true },
  M3: { process: '3nm', cpu: '8コア（高性能4＋高効率4）', gpu: '8コア / 10コア', ne: '16コア（18 TOPS）', bw: '100GB/s', ai: true },
  'M3 Pro': { process: '3nm', cpu: '11コア（高性能5＋高効率6） / 12コア（高性能6＋高効率6）', gpu: '14コア / 18コア', ne: '16コア（18 TOPS）', bw: '150GB/s', ai: true },
  'M3 Max': { process: '3nm', cpu: '14コア（高性能10＋高効率4） / 16コア（高性能12＋高効率4）', gpu: '30コア / 40コア', ne: '16コア（18 TOPS）', bw: '300GB/s / 400GB/s', ai: true },
  'M3 Ultra': { process: '3nm（UltraFusion）', cpu: '28コア（高性能20＋高効率8） / 32コア（高性能24＋高効率8）', gpu: '60コア / 80コア', ne: '32コア', bw: '819GB/s', ai: true },
  M4: { process: '3nm 第2世代', cpu: '9コア（高性能3＋高効率6） / 10コア（高性能4＋高効率6）', gpu: '10コア', ne: '16コア（38 TOPS）', bw: '120GB/s', ai: true },
  'M4 Pro': { process: '3nm 第2世代', cpu: '12コア（高性能8＋高効率4） / 14コア（高性能10＋高効率4）', gpu: '16コア / 20コア', ne: '16コア（38 TOPS）', bw: '273GB/s', ai: true },
  'M4 Max': { process: '3nm 第2世代', cpu: '14コア（高性能10＋高効率4） / 16コア（高性能12＋高効率4）', gpu: '32コア / 40コア', ne: '16コア（38 TOPS）', bw: '410GB/s / 546GB/s', ai: true },
  M5: { process: '3nm 第3世代', cpu: '10コア（高性能4＋高効率6）', gpu: '10コア', ne: '16コア', ai: true },
  'M5 Pro': { process: '3nm 第3世代', ai: true },
  'M5 Max': { process: '3nm 第3世代', ai: true },

  // ---- Apple Watch (S) ----
  S1: { process: '28nm', cpu: 'シングルコア' },
  S1P: { process: '28nm', cpu: 'デュアルコア' },
  S2: { process: '28nm', cpu: 'デュアルコア', gpu: '内蔵GPU（S1比 最大50%高速）' },
  S3: { process: '16nm', cpu: 'デュアルコア' },
  S4: { process: '7nm', cpu: 'デュアルコア（64bit）' },
  S5: { process: '7nm', cpu: 'デュアルコア（64bit）' },
  S6: { process: '7nm', cpu: 'デュアルコア（64bit・A13ベース）' },
  S7: { process: '7nm', cpu: 'デュアルコア（64bit）' },
  S8: { process: '7nm', cpu: 'デュアルコア（64bit）' },
  S9: { process: '4nm', cpu: 'デュアルコア（64bit）', ne: '4コア Neural Engine', ai: false },
  S10: { process: '4nm', cpu: 'デュアルコア（64bit）', ne: '4コア Neural Engine' },
  S11: { process: '4nm', cpu: 'デュアルコア（64bit）', ne: '4コア Neural Engine' },

  // ---- AirPods (W / H) ----
  W1: { process: '—' },
  W2: { process: '—' },
  H1: { process: '—' },
  H2: { process: '—' },
};

/** specs.soc 文字列などから CHIPS のキーを推定する（例: 'A15 Bionic (6コア…)' → 'A15'） */
export function resolveChipKey(raw) {
  if (!raw) return null;
  let s = String(raw).replace(/^Apple\s+/i, '').split(/[（(,]/)[0].trim();
  s = s.replace(/\s+Bionic$/i, '').replace(/\s+SiP.*$/i, '').trim();
  if (CHIPS[s]) return s;
  const m = s.match(/^(A\d+X?Z?|M\d|S\d+P?|W\d|H\d)(?:\s+(Pro|Max|Ultra))?/);
  if (!m) return null;
  const key = m[2] ? `${m[1]} ${m[2]}` : m[1];
  return CHIPS[key] ? key : CHIPS[m[1]] ? m[1] : null;
}

