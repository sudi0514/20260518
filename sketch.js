let handResults; // 用來儲存手部辨識結果

function setup() {
  createCanvas(400, 400);
  createCanvas(640, 480); // 建議將畫布尺寸與攝影機解析度設為一致
}

function draw() {
  background(220);
  
  // 如果 MediaPipe 有辨識到手部，就在 p5.js 畫布上畫出關節點
  if (handResults && handResults.multiHandLandmarks) {
    for (const landmarks of handResults.multiHandLandmarks) {
      for (const landmark of landmarks) {
        fill(255, 0, 0);
        noStroke();
        // MediaPipe 的座標是 0~1 的標準化比例，需乘上畫布寬高以轉換為實際像素座標
        circle(landmark.x * width, landmark.y * height, 10);
      }
    }
  }
}
// 取得 HTML 中的 <video> 元素
const videoElement = document.querySelector('.input_video');

// 初始化 MediaPipe Hands 模型
const hands = new Hands({locateFile: (file) => {
  return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
}});

// 設定模型的參數 (如最多偵測幾隻手、精準度等)
hands.setOptions({
  maxNumHands: 2,
  modelComplexity: 1,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5
});

// 當模型辨識完成時會觸發這個回呼函數，我們將結果存下來給 p5.js 的 draw() 使用
hands.onResults((results) => {
  handResults = results; 
});

// 建立一個 Camera 實例
const camera = new Camera(videoElement, {
  // 當有一張新的攝影機畫面產生時，就會觸發 onFrame
  onFrame: async () => {
    // 這裡通常會將 videoElement 傳給 MediaPipe 的 AI 模型進行辨識
    // 例如：await faceMesh.send({image: videoElement});
    // 將攝影機畫面傳給 MediaPipe Hands 模型進行辨識
    await hands.send({image: videoElement});
  },
  // 設定希望的攝影機解析度
  width: 640,
  height: 480
});

// 啟動攝影機
camera.start();
