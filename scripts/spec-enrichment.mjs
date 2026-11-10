// スペック拡充モジュール: AppleDB (data/cache/appledb-main.json) の自動マッピング ＋ data/specs/ のマスター辞書を
// products の各製品 specs へ統合する（ビルド時に scripts/build-products.mjs から呼び出し）。
//
// 追加される specs キー（すべて文字列。値が無い項目は付与しない → フロントで自動非表示）
//   チップ・AI・OS : process / cpuCores / gpuCores / neuralEngine / ramBandwidth / appleIntelligence / osInitial / osLatest
//   ディスプレイ   : displaySize / resolution / refreshRate / brightness / alwaysOn / frontBio / material / pencil
//   カメラ・操作系 : rearCamera / zoom / video / frontCamera / controls / audio
//   端子・通信     : portSpeed / externalDisplay / charging / simSpec / wireless / extras
//   サイズ・電池   : dimensions / batteryLife
//   技術仕様       : board / arch / releaseDate （identifier / modelNumbers は既存）
import { CHIPS, resolveChipKey } from '../data/specs/chips.mjs';
import { IPHONE_SPECS } from '../data/specs/iphone.mjs';
import { MAC_SPECS } from '../data/specs/mac.mjs';
import { IPAD_SPECS } from '../data/specs/ipad.mjs';
import { WATCH_SPECS, AIRPODS_SPECS } from '../data/specs/watch-airpods.mjs';

/** マスター辞書の短縮キー → specs の正式キー */
const KEYMAP = {
  sz: 'displaySize', res: 'resolution', hz: 'refreshRate', nit: 'brightness', aod: 'alwaysOn', front: 'frontBio', mat: 'material', pen: 'pencil',
  cam: 'rearCamera', zoom: 'zoom', vid: 'video', fcam: 'frontCamera', ctl: 'controls', aud: 'audio',
  port: 'portSpeed', ext: 'externalDisplay', chg: 'charging', sim: 'simSpec', wl: 'wireless', ex: 'extras',
  dim: 'dimensions', gpu: 'gpuCores', bl: 'batteryLife', os0: 'osInitial', os1: 'osLatest', ai: 'appleIntelligence',
};

const MASTER = {
  iPhone: IPHONE_SPECS,
  Mac: MAC_SPECS,
  iPad: IPAD_SPECS,
  'Apple Watch': WATCH_SPECS,
  AirPods: AIRPODS_SPECS,
};

const unique = (arr) => [...new Set(arr.filter(Boolean))];

/** 'XコアCPU' など AppleDB 由来の個別構成数があれば、チップ辞書の複数バリエーションから該当構成を選ぶ */
function pickVariant(text, count) {
  if (!text) return undefined;
  const parts = String(text).split(' / ');
  if (parts.length < 2 || !count) return text;
  return parts.find((p) => p.startsWith(`${count}コア`)) ?? text;
}

function findDevices(product, db) {
  const ids = String(product.specs.identifier ?? '').split(';').map((s) => s.trim()).filter(Boolean);
  const byId = db.filter((d) => d.identifier?.length && ids.some((i) => d.identifier.includes(i)));
  if (byId.length) return byId;
  return db.filter((d) => d.identifier?.length && d.name === product.name);
}

export function enrichProductSpecs(product, db) {
  const s = product.specs;
  const put = (k, v) => {
    if (v === undefined || v === null || v === '') return;
    s[k] = v;
  };

  // ① AppleDB 自動マッピング（旧世代・レガシー機種を含む全製品）
  const devs = findDevices(product, db);
  if (devs.length) {
    put('board', unique(devs.flatMap((d) => [].concat(d.board ?? []))).join(', '));
    put('arch', unique(devs.map((d) => d.arch)).join(', '));
    const models = unique(devs.flatMap((d) => d.model ?? []));
    if (models.length) put('modelNumbers', models.slice(0, 8).join(', '));
    if (!s.identifier) put('identifier', unique(devs.flatMap((d) => d.identifier ?? [])).join(';'));
    if (!s.soc) put('soc', devs.find((d) => d.soc)?.soc);
  }
  put('releaseDate', product.releaseDate);

  // ② チップ辞書（製造プロセス・コア数・Neural Engine・メモリ帯域・Apple Intelligence）
  const chipKey = resolveChipKey(s.soc) ?? resolveChipKey(devs.find((d) => d.soc)?.soc);
  const chip = chipKey ? CHIPS[chipKey] : null;
  if (chip) {
    const cpuN = String(s.soc ?? '').match(/(\d+)(?:,\d+)*コアCPU/)?.[1];
    const gpuN = String(s.soc ?? '').match(/(\d+)コアGPU/)?.[1];
    put('process', chip.process && chip.process !== '—' ? chip.process : undefined);
    put('cpuCores', pickVariant(chip.cpu, cpuN));
    put('gpuCores', pickVariant(chip.gpu, gpuN));
    put('neuralEngine', chip.ne);
    put('ramBandwidth', chip.bw ? `ユニファイドメモリ ${chip.bw}` : undefined);
  }
  if (['iPhone', 'iPad', 'Mac'].includes(product.category)) {
    if (chip) put('appleIntelligence', chip.ai === true ? '対応' : '非対応');
    else if (/Intel|PowerPC/i.test(String(s.soc ?? ''))) put('appleIntelligence', '非対応');
  }

  // ③ マスター辞書（実用スペック。辞書の値が最優先）
  const master = MASTER[product.category]?.[product.id];
  if (master) {
    for (const [short, value] of Object.entries(master)) {
      const key = KEYMAP[short];
      if (!key) continue;
      if (key === 'appleIntelligence') {
        s.appleIntelligence = String(value);
        continue;
      }
      put(key, String(value));
    }
    // 体重・電池容量・RAM は既存値を尊重（辞書では上書きしない）
  }
  return product;
}

export function enrichAllProducts(products, db) {
  const devices = Array.isArray(db) ? db : [];
  let withMaster = 0;
  for (const p of products) {
    enrichProductSpecs(p, devices);
    if (MASTER[p.category]?.[p.id]) withMaster++;
  }
  return { withMaster, total: products.length };
}
