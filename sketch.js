// ═══════════════════════════════════════════════════════════════
//  sketch.js  —  AI 手勢辨識猜拳遊戲
//
//  依賴：
//    - @mediapipe/hands      (手部關鍵點偵測)
//    - @mediapipe/camera_utils (攝影機串流輔助)
//
//  遊戲流程：
//    loading → idle → countdown → reveal → win/lose/draw → menu
//                                                         ↓
//                                                       ended
// ═══════════════════════════════════════════════════════════════


// ───────────────────────────────────────────────────────────────
//  SECTION 1：全域常數與 DOM 元素
// ───────────────────────────────────────────────────────────────

/** Canvas 畫布寬度（像素） */
const W = 640;
/** Canvas 畫布高度（像素） */
const H = 480;

/** 取得 Canvas 元素 */
const cv = document.getElementById('c');
/** 取得 2D 繪圖 Context */
const g = cv.getContext('2d');
/** 取得隱藏的 video 元素（MediaPipe 輸入來源） */
const vid = document.getElementById('vid');

// ── 遊戲資料常數 ──────────────────────────────────────────────

/** 合法的猜拳選項 */
const PICKS = ['rock', 'paper', 'scissors'];

/** 各手勢對應的 Emoji */
const EM = {
  rock: '✊',
  paper: '🖐',
  scissors: '✌️',
  thumbs_up: '👍',
};

/** 各手勢對應的中文標籤 */
const LB = {
  rock: '石頭',
  paper: '布',
  scissors: '剪刀',
  thumbs_up: '讚',
};

/**
 * 勝負關係表：key 打敗 value
 * rock     → scissors（石頭剪刀布：石頭贏剪刀）
 * scissors → paper   （剪刀贏布）
 * paper    → rock    （布贏石頭）
 */
const BEATS = { rock: 'scissors', scissors: 'paper', paper: 'rock' };

/** 粒子特效顏色調色盤 */
const PAL = [
  '#FF6B6B', '#FFE66D', '#4ECDC4',
  '#C3A6FF', '#FF9F43', '#56CCF2',
  '#FD79A8', '#A3F7BF',
];

/**
 * 手部骨架連線索引（MediaPipe 21 個關鍵點的連線定義）
 * 每個子陣列 [a, b] 代表從關鍵點 a 連線到關鍵點 b
 */
const SKEL = [
  [0, 1], [1, 2], [2, 3], [3, 4],       // 拇指
  [0, 5], [5, 6], [6, 7], [7, 8],       // 食指
  [5, 9], [9, 10], [10, 11], [11, 12],  // 中指
  [9, 13], [13, 14], [14, 15], [15, 16],// 無名指
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20], // 小指 + 手掌
];


// ───────────────────────────────────────────────────────────────
//  SECTION 2：遊戲狀態機
// ───────────────────────────────────────────────────────────────

/**
 * 目前遊戲狀態
 * 可能值：'loading' | 'idle' | 'countdown' | 'reveal' |
 *         'win' | 'lose' | 'draw' | 'menu' | 'ended'
 */
let st = 'loading';

/** 進入目前狀態的時間戳（毫秒） */
let stAt = Date.now();

/**
 * 切換遊戲狀態的輔助函式
 * @param {string} s - 目標狀態名稱
 */
const enter = s => { st = s; stAt = Date.now(); };


// ───────────────────────────────────────────────────────────────
//  SECTION 3：手勢偵測相關變數
// ───────────────────────────────────────────────────────────────

/** 玩家目前出的手勢（'rock' | 'paper' | 'scissors' | null） */
let pG = null;
/** 電腦出的手勢 */
let cG = null;

/** MediaPipe 偵測到的手部關鍵點陣列（21 個點） */
let lm = null;
/** 穩定化後的手勢辨識結果 */
let stable = null;
/** 手的慣用側（'Left' | 'Right'） */
let handedness = null;

/** 手勢投票緩衝區（儲存最近 BUF 幀的辨識結果） */
let gBuf = [];
/** 玩家開始保持手勢的時間戳 */
let holdT = null;
/** 選單畫面專用的手勢保持計時器 */
let menuHoldT = null;

/** 手勢投票緩衝區大小（幀數） */
const BUF = 10;
/** 手勢需保持的時間（毫秒），達到後觸發動作 */
const HOLD = 400;
/** 倒數秒數 */
const CD = 3;


// ───────────────────────────────────────────────────────────────
//  SECTION 4：比分與特效變數
// ───────────────────────────────────────────────────────────────

/** 累計比分 { w: 勝, l: 敗, d: 平 } */
let score = { w: 0, l: 0, d: 0 };

/** 粒子特效陣列 */
let parts = [];
/** 煙火計時器 ID（setInterval） */
let fwI = null;
/** 失敗惡魔面具的顯示進度（0.0 ~ 1.0） */
let maskP = 0;

/** 揮手偵測緩衝區（儲存最近 WN 幀的手腕 X 座標與時間） */
let wBuf = [];
/** 上次揮手觸發的時間戳（防止連續觸發） */
let lastSw = 0;
/** 揮手偵測緩衝區大小 */
const WN = 18;


// ───────────────────────────────────────────────────────────────
//  SECTION 5：滑鼠事件監聽
// ───────────────────────────────────────────────────────────────

/** 滑鼠在 Canvas 上的 X 座標（用於按鈕 hover 效果） */
let mx = 0;
/** 滑鼠在 Canvas 上的 Y 座標 */
let my = 0;

cv.addEventListener('mousemove', e => {
  const r = cv.getBoundingClientRect();
  mx = e.clientX - r.left;
  my = e.clientY - r.top;
});

cv.addEventListener('click', onClk);


// ───────────────────────────────────────────────────────────────
//  SECTION 6：MediaPipe 初始化
// ───────────────────────────────────────────────────────────────

(function initMediaPipe() {
  /**
   * 建立 MediaPipe Hands 實例
   * locateFile：指定 WASM 模型檔案的 CDN 路徑
   */
  const hands = new Hands({
    locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`,
  });

  hands.setOptions({
    maxNumHands: 1,          // 最多偵測 1 隻手
    modelComplexity: 1,      // 模型精度（0=快速, 1=精確）
    minDetectionConfidence: 0.72, // 偵測信心閾值
    minTrackingConfidence: 0.5,   // 追蹤信心閾值
  });

  /**
   * 每幀偵測結果回呼
   * @param {Object} r - MediaPipe 回傳的結果物件
   */
  hands.onResults(r => {
    if (r.multiHandLandmarks && r.multiHandLandmarks[0]) {
      // 有偵測到手
      lm = r.multiHandLandmarks[0];
      handedness = r.multiHandedness[0].label; // "Left" 或 "Right"

      // 辨識手勢並加入投票緩衝區
      const gest = classify(lm);
      gBuf.push(gest);
      if (gBuf.length > BUF) gBuf.shift();

      // 多數決穩定化
      stable = vote(gBuf);

      // 記錄手腕位置（鏡像後的 X 座標）供揮手偵測使用
      wBuf.push({ x: 1 - lm[0].x, t: Date.now() });
      if (wBuf.length > WN) wBuf.shift();
    } else {
      // 手消失：重置所有偵測相關變數
      lm = null;
      stable = null;
      handedness = null;
      gBuf = [];
      wBuf = [];
    }
  });

  /**
   * 建立攝影機串流並啟動
   * onFrame：每幀將 video 影像送入 MediaPipe 處理
   */
  new Camera(vid, {
    onFrame: async () => hands.send({ image: vid }),
    width: W,
    height: H,
  })
    .start()
    .then(() => {
      // 攝影機啟動成功後，若仍在載入畫面則切換至 idle
      if (st === 'loading') enter('idle');
    });
})();


// ───────────────────────────────────────────────────────────────
//  SECTION 7：手勢辨識演算法
// ───────────────────────────────────────────────────────────────

/**
 * 根據 21 個手部關鍵點辨識手勢
 *
 * MediaPipe 關鍵點編號（部分）：
 *   0  = 手腕
 *   4  = 拇指尖端
 *   8  = 食指尖端  6  = 食指第二關節
 *   12 = 中指尖端  10 = 中指第二關節
 *   16 = 無名指尖  14 = 無名指第二關節
 *   20 = 小指尖端  18 = 小指第二關節
 *
 * @param {Array} l - 21 個關鍵點陣列，每點含 {x, y, z}（0~1 正規化）
 * @returns {'rock'|'paper'|'scissors'|'thumbs_up'|'unknown'}
 */
function classify(l) {
  // 四指（食中無小）的尖端與第二關節索引
  const tips = [8, 12, 16, 20];
  const pips = [6, 10, 14, 18];

  // 判斷各手指是否伸直（尖端 y < 第二關節 y，因 y 軸向下，故 y 較小表示較高）
  const ext = tips.map((t, i) => l[t].y < l[pips[i]].y);
  // 伸直手指數量
  const n = ext.filter(Boolean).length;

  // ── 比讚（Thumbs Up）偵測 ──────────────────────────────────
  // 條件：拇指尖端明顯高於拇指各關節與食指根部，且四指均未伸直
  const thumbUp =
    l[4].y < l[3].y &&  // 拇指尖端高於拇指第三關節
    l[4].y < l[2].y &&  // 拇指尖端高於拇指第二關節
    l[4].y < l[5].y;    // 拇指尖端高於食指根部
  if (thumbUp && n === 0) return 'thumbs_up';

  // ── 石頭（Rock）：所有手指均未伸直 ────────────────────────
  if (n === 0) return 'rock';

  // ── 布（Paper）：大多數手指伸直（3 根以上） ───────────────
  if (n >= 3) return 'paper';

  // ── 剪刀（Scissors）：食指與中指伸直，無名指與小指彎曲 ────
  if (ext[0] && ext[1] && !ext[2] && !ext[3]) return 'scissors';

  return 'unknown';
}

/**
 * 對手勢緩衝區進行多數決投票，回傳穩定的手勢
 *
 * @param {string[]} buf - 手勢緩衝區
 * @returns {string|null} 穩定手勢，或 null（尚未穩定）
 */
function vote(buf) {
  // 緩衝區資料不足，無法判定
  if (buf.length < 6) return null;

  // 統計各手勢出現次數（排除 unknown）
  const c = {};
  buf.forEach(v => { c[v] = (c[v] || 0) + 1; });

  let best = null, bestN = 0;
  for (const v in c) {
    if (v !== 'unknown' && c[v] > bestN) {
      bestN = c[v];
      best = v;
    }
  }

  // 需達到 55% 以上的比例才視為穩定
  return bestN / buf.length >= 0.55 ? best : null;
}


// ───────────────────────────────────────────────────────────────
//  SECTION 8：揮手偵測
// ───────────────────────────────────────────────────────────────

/**
 * 偵測玩家是否做出左右揮手動作
 *
 * 原理：比較最近 WN 幀中手腕 X 座標的位移量
 * 注意：座標已鏡像（1 - x），所以向右揮 = dx 為正
 *
 * @returns {'right'|'left'|null}
 */
function checkSwipe() {
  // 緩衝區不足或距上次揮手不到 1 秒，不偵測
  if (wBuf.length < WN || Date.now() - lastSw < 1000) return null;

  const span = wBuf.at(-1).t - wBuf[0].t;
  // 揮動時間超過 800ms 視為太慢，不算
  if (span > 800) return null;

  const dx = wBuf.at(-1).x - wBuf[0].x;
  if (dx > 0.22) {
    lastSw = Date.now();
    wBuf = [];
    return 'right';
  }
  if (dx < -0.22) {
    lastSw = Date.now();
    wBuf = [];
    return 'left';
  }
  return null;
}


// ───────────────────────────────────────────────────────────────
//  SECTION 9：粒子特效系統
// ───────────────────────────────────────────────────────────────

/**
 * 在指定位置產生一批粒子（爆炸效果）
 *
 * @param {number} x   - 爆炸中心 X
 * @param {number} y   - 爆炸中心 Y
 * @param {number} n   - 粒子數量（預設 55）
 * @param {string} col - 粒子顏色（預設隨機）
 */
function burst(x, y, n = 55, col) {
  col = col || PAL[Math.random() * PAL.length | 0];
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;   // 隨機方向角
    const sp = Math.random() * 8 + 1;         // 隨機速度
    parts.push({
      x, y,
      vx: Math.cos(a) * sp,                  // X 速度分量
      vy: Math.sin(a) * sp - 2,              // Y 速度分量（初始向上偏移）
      life: 1,                                // 生命值（1.0 = 完全不透明）
      dec: Math.random() * 0.02 + 0.01,      // 每幀生命值遞減量
      sz: Math.random() * 5 + 2,             // 粒子半徑
      col,
    });
  }
}

/**
 * 更新所有粒子的物理狀態（每幀呼叫）
 * - 套用速度、重力、空氣阻力
 * - 移除生命值 <= 0 的粒子
 */
function tickP() {
  parts.forEach(p => {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.18;   // 重力加速度
    p.vx *= 0.97;   // 水平空氣阻力
    p.life -= p.dec;
  });
  parts = parts.filter(p => p.life > 0);
}

/**
 * 繪製所有粒子（每幀呼叫）
 */
function drawP() {
  parts.forEach(p => {
    g.save();
    g.globalAlpha = p.life;
    g.fillStyle = p.col;
    g.beginPath();
    g.arc(p.x, p.y, p.sz * p.life, 0, Math.PI * 2);
    g.fill();
    g.restore();
  });
}

/**
 * 啟動持續性煙火特效（玩家獲勝時使用）
 */
function startFW() {
  // 立即爆炸一次
  burst(Math.random() * W, Math.random() * H * 0.6 + 20, 70);
  // 延遲連續爆炸
  for (let i = 1; i < 5; i++) {
    setTimeout(
      () => burst(Math.random() * W, Math.random() * H * 0.65 + 20, 60),
      i * 200
    );
  }
  // 持續每 550ms 爆炸一次
  fwI = setInterval(
    () => burst(Math.random() * W, Math.random() * H * 0.6 + 30, 50),
    550
  );
}

/**
 * 停止煙火特效
 */
function stopFW() {
  if (fwI) {
    clearInterval(fwI);
    fwI = null;
  }
}


// ───────────────────────────────────────────────────────────────
//  SECTION 10：繪圖工具函式
// ───────────────────────────────────────────────────────────────

/**
 * 繪製圓角矩形路徑（不填色，需自行呼叫 fill/stroke）
 *
 * @param {number} x - 左上角 X
 * @param {number} y - 左上角 Y
 * @param {number} w - 寬度
 * @param {number} h - 高度
 * @param {number} r - 圓角半徑
 */
function rr(x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/**
 * 將 MediaPipe 正規化座標轉換為 Canvas 像素座標
 * 同時進行左右鏡像（1 - p.x），使畫面符合鏡子效果
 *
 * @param {Object} p - MediaPipe 關鍵點 {x, y}
 * @returns {[number, number]} [canvasX, canvasY]
 */
function lxy(p) {
  return [(1 - p.x) * W, p.y * H];
}

/**
 * 繪製手部骨架（關鍵點 + 連線）
 */
function skel() {
  if (!lm) return;
  g.save();

  // 繪製骨架連線
  g.strokeStyle = 'rgba(0,255,130,.8)';
  g.lineWidth = 2;
  SKEL.forEach(([a, b]) => {
    const [ax, ay] = lxy(lm[a]);
    const [bx, by] = lxy(lm[b]);
    g.beginPath();
    g.moveTo(ax, ay);
    g.lineTo(bx, by);
    g.stroke();
  });

  // 繪製關鍵點圓點（手腕用紅色，其餘用綠色）
  lm.forEach((p, i) => {
    const [x, y] = lxy(p);
    g.fillStyle = i ? '#00FF88' : '#FF4466';
    g.beginPath();
    g.arc(x, y, i ? 3.5 : 6, 0, Math.PI * 2);
    g.fill();
  });

  g.restore();
}

/**
 * 繪製粗體文字（帶陰影與描邊效果）
 *
 * @param {string} t      - 文字內容
 * @param {number} x      - 中心 X
 * @param {number} y      - 中心 Y
 * @param {number} fs     - 字體大小（px）
 * @param {string} col    - 填色（預設白色）
 * @param {string} stroke - 描邊色（可選）
 * @param {string} shadow - 陰影色（可選）
 */
function boldT(t, x, y, fs, col, stroke, shadow) {
  g.save();
  g.font = `bold ${fs}px Arial`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (shadow) { g.shadowColor = shadow; g.shadowBlur = 28; }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = 4; g.strokeText(t, x, y); }
  g.fillStyle = col || '#FFF';
  g.fillText(t, x, y);
  g.restore();
}

/**
 * 繪製一般文字（半透明風格）
 *
 * @param {string} t   - 文字內容
 * @param {number} x   - 中心 X
 * @param {number} y   - 中心 Y
 * @param {number} fs  - 字體大小（px）
 * @param {string} col - 顏色（預設半透明白）
 */
function smT(t, x, y, fs, col) {
  g.save();
  g.font = `${fs}px Arial`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = col || 'rgba(255,255,255,.6)';
  g.fillText(t, x, y);
  g.restore();
}

/**
 * 繪製右上角比分 HUD（勝/敗/平）
 */
function scoreHUD() {
  g.save();
  const sw = 192, sh = 34;
  const sx = W - sw - 8, sy = 8;

  // 半透明黑色背景
  g.fillStyle = 'rgba(0,0,0,.58)';
  rr(sx, sy, sw, sh, 8);
  g.fill();

  g.font = 'bold 13px Arial';
  g.textBaseline = 'middle';
  g.textAlign = 'left';

  g.fillStyle = '#00FF88';
  g.fillText(`✅ ${score.w}勝`, sx + 10, sy + sh / 2);
  g.fillStyle = '#FF6B6B';
  g.fillText(`❌ ${score.l}敗`, sx + 72, sy + sh / 2);
  g.fillStyle = '#FFD93D';
  g.fillText(`🤝 ${score.d}平`, sx + 138, sy + sh / 2);

  g.restore();
}

/**
 * 繪製手勢卡片（顯示 Emoji + 中文名稱）
 *
 * @param {string} gest - 手勢名稱
 * @param {number} x    - 左上角 X
 * @param {number} y    - 左上角 Y
 * @param {number} w    - 寬度
 * @param {number} h    - 高度
 * @param {string} acc  - 強調色（邊框 + 文字）
 * @param {number} a    - 透明度（0~1，預設 1）
 */
function card(gest, x, y, w, h, acc, a = 1) {
  g.save();
  g.globalAlpha = a;

  // 半透明填色背景
  g.fillStyle = acc + '22';
  g.strokeStyle = acc;
  g.lineWidth = 2;
  rr(x, y, w, h, 14);
  g.fill();
  g.stroke();

  // Emoji
  g.font = `${Math.floor(h * 0.44)}px sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#FFF';
  g.fillText(EM[gest] || '❓', x + w / 2, y + h * 0.46);

  // 中文標籤
  g.font = `bold ${Math.floor(h * 0.17)}px Arial`;
  g.fillStyle = acc;
  g.fillText(LB[gest] || '？', x + w / 2, y + h * 0.8);

  g.restore();
}

/**
 * 繪製互動按鈕（滑鼠 hover 時反白）
 *
 * @param {string} lbl - 按鈕文字
 * @param {number} x   - 左上角 X
 * @param {number} y   - 左上角 Y
 * @param {number} w   - 寬度
 * @param {number} h   - 高度
 * @param {string} bg  - 按鈕顏色
 */
function btn(lbl, x, y, w, h, bg) {
  const hov = mx >= x && mx <= x + w && my >= y && my <= y + h;
  g.save();
  g.fillStyle = hov ? '#FFF' : bg;
  g.shadowColor = bg;
  g.shadowBlur = hov ? 24 : 10;
  rr(x, y, w, h, h / 2);
  g.fill();
  g.shadowBlur = 0;
  g.font = `bold ${Math.floor(h * 0.38)}px Arial`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = hov ? bg : '#FFF';
  g.fillText(lbl, x + w / 2, y + h / 2);
  g.restore();
}


// ───────────────────────────────────────────────────────────────
//  SECTION 11：失敗惡魔面具動畫
// ───────────────────────────────────────────────────────────────

/**
 * 繪製失敗時出現的惡魔面具（帶哭泣眼睛、角、傷心嘴）
 *
 * @param {number} cx - 面具中心 X
 * @param {number} cy - 面具中心 Y
 * @param {number} p  - 顯示進度（0.0 ~ 1.0）
 */
function drawMask(cx, cy, p) {
  if (p <= 0) return;
  const r = 78 * p;
  g.save();
  g.globalAlpha = p;

  // ── 臉部橢圓 ──────────────────────────────────────────────
  g.fillStyle = '#4A0000';
  g.strokeStyle = '#BB1100';
  g.lineWidth = 3;
  g.beginPath();
  g.ellipse(cx, cy, r, r * 1.15, 0, 0, Math.PI * 2);
  g.fill();
  g.stroke();

  if (p > 0.35) {
    const q = (p - 0.35) / 0.65; // 細節顯示進度

    // ── 空洞眼睛 ────────────────────────────────────────────
    [cx - 24, cx + 24].forEach(ex => {
      g.fillStyle = '#1A0000';
      g.beginPath();
      g.ellipse(ex, cy - 16, 13 * q, 8 * q, 0, 0, Math.PI * 2);
      g.fill();
      // 眼白反光點
      g.fillStyle = '#DDD';
      g.beginPath();
      g.arc(ex + 3, cy - 20, 4 * q, 0, Math.PI * 2);
      g.fill();
    });

    // ── 傷心嘴（向下弧線） ──────────────────────────────────
    g.strokeStyle = '#1A0000';
    g.lineWidth = 4;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(cx - 28 * q, cy + 26);
    g.quadraticCurveTo(cx, cy + 52 * q, cx + 28 * q, cy + 26);
    g.stroke();

    // ── 眼淚 ────────────────────────────────────────────────
    if (q > 0.5) {
      const tp = (q - 0.5) / 0.5;
      g.fillStyle = 'rgba(90,140,255,.85)';
      [cx - 27, cx + 27].forEach(tx => {
        g.beginPath();
        g.ellipse(tx, cy - 2 + 28 * tp, 4, 13 * tp, 0, 0, Math.PI * 2);
        g.fill();
      });
    }

    // ── 惡魔角 ──────────────────────────────────────────────
    [[-1, cx - r + 15], [1, cx + r - 15]].forEach(([d, hx]) => {
      g.fillStyle = '#7A0000';
      g.strokeStyle = '#FF3300';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(hx - 10 * d, cy - r * 0.78);
      g.lineTo(hx, cy - r * 1.22 * q);
      g.lineTo(hx + 10 * d, cy - r * 0.78);
      g.closePath();
      g.fill();
      g.stroke();
    });

    // ── 臉頰羞恥 X 符號 ─────────────────────────────────────
    g.strokeStyle = '#CC0000';
    g.lineWidth = 3;
    g.lineCap = 'round';
    [[cx - 50, cy], [cx + 50, cy]].forEach(([ex, ey]) => {
      const s = 7 * q;
      g.beginPath(); g.moveTo(ex - s, ey - s); g.lineTo(ex + s, ey + s); g.stroke();
      g.beginPath(); g.moveTo(ex + s, ey - s); g.lineTo(ex - s, ey + s); g.stroke();
    });

    // ── 裝飾性外圈 ──────────────────────────────────────────
    g.strokeStyle = 'rgba(180,0,0,.5)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.ellipse(cx, cy, r * 1.12, r * 1.28, 0, 0, Math.PI * 2);
    g.stroke();
  }

  g.restore();
}


// ───────────────────────────────────────────────────────────────
//  SECTION 12：攝影機畫面繪製
// ───────────────────────────────────────────────────────────────

/**
 * 將攝影機影像鏡像繪製到 Canvas
 * 使用 translate + scale(-1,1) 達到水平翻轉效果
 */
function drawVid() {
  if (!vid || vid.readyState < 2) return;
  g.save();
  g.translate(W, 0);
  g.scale(-1, 1);
  g.drawImage(vid, 0, 0, W, H);
  g.restore();
}


// ───────────────────────────────────────────────────────────────
//  SECTION 13：各狀態的畫面渲染函式
// ───────────────────────────────────────────────────────────────

/**
 * 載入畫面：顯示旋轉載入動畫
 */
function dLoading() {
  g.fillStyle = '#0d1117';
  g.fillRect(0, 0, W, H);

  const t = Date.now() / 1000;
  boldT('載入 AI 手勢辨識中…', W / 2, H / 2 - 24, 26, '#FFF', null, '#4ECDC4');

  // 旋轉弧形載入指示器
  g.save();
  g.strokeStyle = '#4ECDC4';
  g.lineWidth = 5;
  g.lineCap = 'round';
  g.beginPath();
  g.arc(W / 2, H / 2 + 44, 24, t * 2.8, t * 2.8 + Math.PI * 1.4);
  g.stroke();
  g.restore();

  smT('請允許攝影機存取', W / 2, H / 2 + 94, 14, 'rgba(255,255,255,.35)');
  smT('✊ 石頭   🖐 布   ✌️ 剪刀', W / 2, H / 2 + 130, 16, 'rgba(255,255,255,.5)');
}

/**
 * 待機畫面：顯示攝影機畫面 + 手勢鎖定進度條
 */
function dIdle() {
  skel();
  scoreHUD();

  // 右上角顯示目前偵測到的手勢
  if (stable) {
    g.save();
    const isValid = PICKS.includes(stable);
    const bgCol = isValid ? 'rgba(0,180,100,0.6)' : 'rgba(0,0,0,0.55)';
    g.fillStyle = bgCol;
    rr(W - 145, 8, 130, 48, 10);
    g.fill();
    g.font = '22px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#FFF';
    g.fillText(EM[stable], W - 115, 32);
    g.font = 'bold 15px Arial';
    g.fillStyle = '#FFF';
    g.fillText(LB[stable], W - 75, 32);
    g.restore();
  }

  // 底部漸層遮罩
  const gr = g.createLinearGradient(0, H - 148, 0, H);
  gr.addColorStop(0, 'rgba(0,0,0,0)');
  gr.addColorStop(1, 'rgba(0,0,0,.9)');
  g.fillStyle = gr;
  g.fillRect(0, H - 148, W, 148);

  if (!lm) {
    // 未偵測到手
    boldT('請將手伸入畫面', W / 2, H - 90, 22, '#FFF');
    smT('比出  ✊ 石頭  ·  🖐 布  ·  ✌️ 剪刀', W / 2, H - 56, 15);
  } else if (stable) {
    const isValid = PICKS.includes(stable);
    boldT(
      isValid ? `鎖定中：${EM[stable]} ${LB[stable]}` : `請換個手勢：${EM[stable]}`,
      W / 2, H - 102, 20,
      isValid ? '#00FF88' : '#FFD93D',
      null,
      isValid ? '#00FF88' : null
    );

    // 手勢保持進度條
    const pct = holdT ? Math.min(1, (Date.now() - holdT) / HOLD) : 0;
    g.fillStyle = 'rgba(255,255,255,.18)';
    rr(W / 2 - 104, H - 70, 208, 13, 6);
    g.fill();
    g.fillStyle = pct < 0.5 ? '#FFD93D' : pct < 0.9 ? '#4ECDC4' : '#00FF88';
    rr(W / 2 - 104, H - 70, 208 * pct, 13, 6);
    g.fill();

    smT(
      !isValid ? '⚠️ 這是功能鍵，請比出拳手勢' : pct < 1 ? '保持手勢，即將開始...' : 'GO!',
      W / 2, H - 44, 13, 'rgba(255,255,255,.7)'
    );
  } else {
    boldT('請比出石頭 / 布 / 剪刀', W / 2, H - 82, 18, '#FFD93D');
    smT('確保手部清晰，保持手勢 0.5 秒', W / 2, H - 52, 14, 'rgba(255,255,255,.4)');
  }
}

/**
 * 倒數計時畫面：顯示 3、2、1 大數字
 */
function dCountdown() {
  const el = Date.now() - stAt;
  skel();
  scoreHUD();

  const rem = CD * 1000 - el;
  const sc = Math.ceil(rem / 1000);
  const col = sc === 1 ? '#FF4444' : sc === 2 ? '#FFB700' : '#00FF88';

  // 脈衝縮放效果
  const pulse = 1 + 0.22 * Math.abs(Math.sin(el / 280));
  g.save();
  g.translate(W / 2, H / 2);
  g.scale(pulse, pulse);
  g.font = 'bold 118px Arial';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = col;
  g.shadowBlur = 45;
  g.fillStyle = col;
  g.fillText(sc, 0, 0);
  g.restore();

  // 頂部：玩家手勢提示
  g.fillStyle = 'rgba(0,0,0,.65)';
  g.fillRect(0, 0, W, 68);
  boldT(`你出：${EM[pG] || '？'} ${LB[pG] || '？'}`, W / 2, 34, 22, '#FFF');

  // 底部：電腦思考提示
  g.fillStyle = 'rgba(0,0,0,.55)';
  g.fillRect(0, H - 50, W, 50);
  const dots = '.'.repeat(Math.floor(el / 380) % 4);
  smT(`電腦正在思考${dots}`, W / 2, H - 25, 15);
}

/**
 * 揭曉畫面：左右對比顯示玩家與電腦的手勢
 */
function dReveal() {
  const el = Date.now() - stAt;
  const cpuA = Math.min(1, Math.max(0, (el - 400) / 500)); // 電腦卡片淡入進度

  // 背景
  g.fillStyle = 'rgba(0,0,0,.7)';
  g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(20,70,200,.3)';
  g.fillRect(0, 0, W / 2 - 2, H);
  g.fillStyle = 'rgba(200,20,20,.3)';
  g.fillRect(W / 2 + 2, 0, W / 2 - 2, H);

  // 標題
  boldT('你', W / 4, 36, 20, '#AAD4FF');
  boldT('電腦', W * 3 / 4, 36, 20, '#FFAAAA');
  boldT('VS', W / 2, H / 2, 38, '#FFF', null, '#FFF');

  // 手勢卡片
  card(pG, 42, H / 2 - 72, W / 2 - 82, 144, '#4488FF');
  card(cG, W / 2 + 40, H / 2 - 72, W / 2 - 82, 144, '#FF4444', cpuA);

  // 電腦卡片未揭曉時顯示問號
  if (cpuA < 0.95) {
    g.save();
    g.font = '60px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.globalAlpha = 1 - cpuA;
    g.fillStyle = 'rgba(255,255,255,.7)';
    g.fillText('❓', W * 3 / 4, H / 2);
    g.restore();
  }

  scoreHUD();
}

/**
 * 勝利畫面：煙火特效 + 慶祝文字
 */
function dWin() {
  drawP();
  scoreHUD();
  const el = Date.now() - stAt;
  const pulse = 1 + 0.07 * Math.sin(el / 170);

  g.fillStyle = 'rgba(0,0,0,.65)';
  g.fillRect(0, 0, W, 88);
  boldT('🎉 恭喜你贏了！🎉', W / 2, 44, Math.floor(44 * pulse), '#FFD700', '#FF6600', '#FFD700');

  g.fillStyle = 'rgba(0,0,0,.62)';
  g.fillRect(0, H - 76, W, 76);
  smT(`你的 ${EM[pG]}${LB[pG]}  打敗了  電腦的 ${EM[cG]}${LB[cG]}`, W / 2, H - 38, 21, '#FFF');
}

/**
 * 失敗畫面：惡魔面具 + 抖動文字
 */
function dLose() {
  const el = Date.now() - stAt;
  maskP = Math.min(1, el / 700);

  // 紅色漸層遮罩
  g.fillStyle = `rgba(140,0,0,${maskP * 0.35})`;
  g.fillRect(0, 0, W, H);

  // 惡魔面具（右側）
  drawMask(W * 0.72, H * 0.42, maskP);

  scoreHUD();

  g.fillStyle = 'rgba(0,0,0,.72)';
  g.fillRect(0, 0, W, 88);

  // 抖動效果（前 800ms）
  const sh = el < 800 ? Math.sin(el / 38) * 4 : 0;
  boldT('😢 你輸了！', W / 2 + sh, 44, 44, '#FF2222', '#000', '#FF2222');

  g.fillStyle = 'rgba(0,0,0,.65)';
  g.fillRect(0, H - 76, W, 76);
  smT(`你的 ${EM[pG]}${LB[pG]}  輸給了  電腦的 ${EM[cG]}${LB[cG]}`, W / 2, H - 38, 21, '#FFF');
}

/**
 * 平局畫面：脈衝文字
 */
function dDraw() {
  const el = Date.now() - stAt;
  const pulse = 1 + 0.06 * Math.sin(el / 160);
  scoreHUD();

  g.fillStyle = 'rgba(0,0,0,.65)';
  g.fillRect(0, 0, W, 88);
  boldT('🤝 平局！再來一次！', W / 2, 44, Math.floor(42 * pulse), '#FFD93D', '#000', '#FFD93D');

  g.fillStyle = 'rgba(0,0,0,.62)';
  g.fillRect(0, H - 76, W, 76);
  smT(`你們都出了 ${EM[pG]}${LB[pG]}，旗鼓相當！`, W / 2, H - 38, 21, '#FFF');
}

/**
 * 選單畫面：詢問是否繼續，支援滑鼠點擊與手勢操作
 *
 * 手勢操作：
 *   右手比 👍 並保持 → 繼續遊戲
 *   左手比 👍 並保持 → 結束遊戲
 */
function dMenu() {
  g.fillStyle = 'rgba(0,0,0,.78)';
  g.fillRect(0, 0, W, H);
  scoreHUD();

  boldT('再玩一局？', W / 2, H / 2 - 78, 34, '#FFF');

  // 比分摘要
  g.save();
  g.fillStyle = 'rgba(255,255,255,.07)';
  rr(W / 2 - 140, H / 2 - 50, 280, 35, 8);
  g.fill();
  g.font = '14px Arial';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(255,255,255,.5)';
  g.fillText(`✅ ${score.w}勝  ❌ ${score.l}敗  🤝 ${score.d}平`, W / 2, H / 2 - 33);
  g.restore();

  smT('點擊按鈕，或比出 👍 選擇', W / 2, H / 2 + 6, 14);

  // 按鈕
  const bw = 132, bh = 52, by = H / 2 + 24;
  btn('🏠 結束', W / 2 - bw - 8, by, bw, bh, '#CC2200');
  btn('🎮 繼續', W / 2 + 8, by, bw, bh, '#00AA44');

  // 手勢操作說明
  g.save();
  g.fillStyle = 'rgba(255,255,255,.06)';
  rr(20, H / 2 + 90, W - 40, 32, 8);
  g.fill();
  g.font = '13px Arial';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(255,255,255,.45)';
  g.fillText('💡 右手比 👍 🎮 繼續  ·  左手比 👍 🏠 結束', W / 2, H / 2 + 106);
  g.restore();

  // 手勢選擇進度條
  if (st === 'menu' && stable === 'thumbs_up') {
    const pct = menuHoldT ? Math.min(1, (Date.now() - menuHoldT) / HOLD) : 0;
    const isRight = handedness === 'Right';
    const col = isRight ? '#00FF88' : '#FF4444';

    g.fillStyle = 'rgba(255,255,255,0.1)';
    rr(W / 2 - 100, H / 2 + 132, 200, 8, 4);
    g.fill();
    g.fillStyle = col;
    rr(W / 2 - 100, H / 2 + 132, 200 * pct, 8, 4);
    g.fill();

    const txt = isRight ? '🎮 準備繼續...' : '🏠 準備結束...';
    boldT(txt, W / 2, H / 2 + 158, 20, col, '#000');
  }
}

/**
 * 結束畫面：顯示最終比分
 */
function dEnded() {
  g.fillStyle = '#0d1117';
  g.fillRect(0, 0, W, H);
  boldT('感謝遊戲！', W / 2, H / 2 - 60, 48, '#FFF', null, '#4ECDC4');

  g.save();
  g.font = 'bold 20px Arial';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(255,255,255,.65)';
  g.fillText(`✅ ${score.w} 勝  ❌ ${score.l} 敗  🤝 ${score.d} 平`, W / 2, H / 2 + 10);
  g.restore();

  smT('重新整理頁面可再次遊戲', W / 2, H / 2 + 60, 15, 'rgba(255,255,255,.32)');
}


// ───────────────────────────────────────────────────────────────
//  SECTION 14：遊戲邏輯更新（每幀呼叫）
// ───────────────────────────────────────────────────────────────

/**
 * 每幀更新遊戲狀態
 * - 更新粒子
 * - 處理各狀態的邏輯轉換
 */
function update() {
  const now = Date.now();
  const el = now - stAt;
  tickP(); // 更新粒子物理

  // ── 選單狀態：手勢選擇邏輯 ──────────────────────────────
  if (st === 'menu') {
    if (stable === 'thumbs_up' && handedness) {
      if (!menuHoldT) menuHoldT = now;
      if (now - menuHoldT >= HOLD) {
        if (handedness === 'Right') startGame(); // 右手 → 繼續
        else enter('ended');                     // 左手 → 結束
        menuHoldT = null;
      }
    } else {
      menuHoldT = null; // 手勢消失，重置計時
    }
  }

  // ── 待機狀態：偵測手勢鎖定 ──────────────────────────────
  if (st === 'idle') {
    if (stable && PICKS.includes(stable)) {
      // 偵測到有效猜拳手勢
      if (pG !== stable) {
        // 手勢改變，重新計時
        holdT = now;
        pG = stable;
      }
      if (now - holdT >= HOLD) {
        enter('countdown'); // 保持足夠時間，進入倒數
      }
    } else if (stable === 'thumbs_up' || !lm) {
      // 手消失或比讚，重置（避免閃爍中斷計時）
      holdT = null;
      pG = null;
    }
  }

  // ── 倒數狀態：允許更新手勢，倒數結束後揭曉 ─────────────
  if (st === 'countdown') {
    if (stable && PICKS.includes(stable)) pG = stable;
    if (el >= CD * 1000) {
      if (!pG) pG = PICKS[Math.random() * 3 | 0]; // 若無手勢則隨機
      cG = PICKS[Math.random() * 3 | 0];           // 電腦隨機出拳
      enter('reveal');
    }
  }

  // ── 揭曉狀態：1.5 秒後判定勝負 ──────────────────────────
  if (st === 'reveal' && el > 1500) {
    const res = pG === cG ? 'draw' : BEATS[pG] === cG ? 'win' : 'lose';
    if (res === 'win') score.w++;
    else if (res === 'lose') score.l++;
    else score.d++;
    enter(res);
    maskP = 0;
    if (res === 'win') startFW(); // 勝利時啟動煙火
  }

  // ── 各結果狀態：顯示一段時間後進入選單 ──────────────────
  if (st === 'win' && el > 4800) { stopFW(); enter('menu'); }
  if (st === 'lose' && el > 3800) enter('menu');
  if (st === 'draw' && el > 2800) enter('menu');
}


// ───────────────────────────────────────────────────────────────
//  SECTION 15：滑鼠點擊處理
// ───────────────────────────────────────────────────────────────

/**
 * 處理 Canvas 點擊事件（僅在選單狀態有效）
 *
 * @param {MouseEvent} e
 */
function onClk(e) {
  if (st !== 'menu') return;
  const r = cv.getBoundingClientRect();
  const cx = e.clientX - r.left;
  const cy = e.clientY - r.top;
  const bw = 132, bh = 52, by = H / 2 + 24;

  // 右側「繼續」按鈕
  if (cx >= W / 2 + 8 && cx <= W / 2 + 8 + bw && cy >= by && cy <= by + bh) {
    startGame();
  }
  // 左側「結束」按鈕
  if (cx >= W / 2 - bw - 8 && cx <= W / 2 - 8 && cy >= by && cy <= by + bh) {
    enter('ended');
  }
}

/**
 * 重置並開始新一局遊戲
 */
function startGame() {
  parts = [];
  maskP = 0;
  gBuf = [];
  stable = null;
  holdT = null;
  pG = null;
  cG = null;
  stopFW();
  enter('idle');
}


// ───────────────────────────────────────────────────────────────
//  SECTION 16：主遊戲迴圈
// ───────────────────────────────────────────────────────────────

/**
 * 狀態名稱 → 渲染函式的對應表
 */
const DRAW_FN = {
  loading: dLoading,
  idle: dIdle,
  countdown: dCountdown,
  reveal: dReveal,
  win: dWin,
  lose: dLose,
  draw: dDraw,
  menu: dMenu,
  ended: dEnded,
};

/**
 * 主迴圈（requestAnimationFrame 驅動）
 * 每幀執行：更新邏輯 → 清除畫布 → 繪製攝影機 → 繪製 UI
 */
function loop() {
  update();
  g.clearRect(0, 0, W, H);

  // 非載入/結束狀態才顯示攝影機畫面
  if (st !== 'loading' && st !== 'ended') drawVid();

  // 呼叫對應的渲染函式
  (DRAW_FN[st] || dLoading)();

  requestAnimationFrame(loop);
}

// 啟動主迴圈
loop();
如何在VSCode中實現手勢操作遊戲 - Manus