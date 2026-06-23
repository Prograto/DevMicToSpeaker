// DOM Elements
const appCard = document.querySelector('.app-card');
const powerBtn = document.getElementById('powerBtn');
const powerHint = document.getElementById('powerHint');
const statusText = document.getElementById('statusText');
const volumeSlider = document.getElementById('volumeSlider');
const volumeVal = document.getElementById('volumeVal');
const deviceSelect = document.getElementById('deviceSelect');
const warningBanner = document.getElementById('warningBanner');
const closeWarningBtn = document.getElementById('closeWarningBtn');
const settingsToggle = document.getElementById('settingsToggle');
const settingsContent = document.getElementById('settingsContent');

// Advanced configuration switches
const echoCancelCheckbox = document.getElementById('echoCancel');
const noiseSuppressCheckbox = document.getElementById('noiseSuppress');
const autoGainCheckbox = document.getElementById('autoGain');

// Visualizer canvas
const canvas = document.getElementById('audioCanvas');
const canvasCtx = canvas.getContext('2d');

// Web Audio State
let audioContext = null;
let mediaStream = null;
let sourceNode = null;
let gainNode = null;
let analyserNode = null;
let animationFrameId = null;
let isActive = false;

// Initialize device listing and event listeners
window.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  requestDevicesList(false); // Try reading devices (labels might be empty until permission granted)
  resizeCanvas();
  drawEmptyState();
});

window.addEventListener('resize', resizeCanvas);

function resizeCanvas() {
  // Set internal resolution based on element display size to prevent stretching
  canvas.width = canvas.clientWidth * window.devicePixelRatio;
  canvas.height = canvas.clientHeight * window.devicePixelRatio;
  if (!isActive) {
    drawEmptyState();
  }
}

function setupEventListeners() {
  // Power loopback trigger
  powerBtn.addEventListener('click', toggleLoopback);

  // Volume control
  volumeSlider.addEventListener('input', (e) => {
    const gainValue = e.target.value / 100;
    volumeVal.textContent = `${e.target.value}%`;
    if (gainNode && audioContext) {
      // Smooth volume transitions to avoid clicks/pops
      gainNode.gain.setTargetAtTime(gainValue, audioContext.currentTime, 0.01);
    }
  });

  // Hot swap device/settings changes
  deviceSelect.addEventListener('change', () => {
    if (isActive) restartLoopback();
  });

  [echoCancelCheckbox, noiseSuppressCheckbox, autoGainCheckbox].forEach(checkbox => {
    checkbox.addEventListener('change', () => {
      if (isActive) restartLoopback();
    });
  });

  // Settings pane collapse
  settingsToggle.addEventListener('click', () => {
    settingsToggle.classList.toggle('open');
    settingsContent.classList.toggle('open');
  });

  // Dismiss Warning banner
  closeWarningBtn.addEventListener('click', () => {
    warningBanner.style.display = 'none';
  });
}

// Enumerate available input devices
async function requestDevicesList(forcePermissionRequest = false) {
  try {
    // If permission is forced, trigger a brief access to get real labels
    if (forcePermissionRequest) {
      const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      tempStream.getTracks().forEach(track => track.stop());
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(device => device.kind === 'audioinput');

    // Store currently selected device ID if any
    const currentSelection = deviceSelect.value;

    // Clear dropdown
    deviceSelect.innerHTML = '';

    if (audioInputs.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No microphones found';
      deviceSelect.appendChild(opt);
      return;
    }

    audioInputs.forEach((device, index) => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || `Microphone ${index + 1} (Unlabeled)`;
      deviceSelect.appendChild(option);
    });

    // Reapply selection or default
    if (currentSelection && audioInputs.some(d => d.deviceId === currentSelection)) {
      deviceSelect.value = currentSelection;
    }
  } catch (err) {
    console.error('Error listing audio inputs:', err);
  }
}

async function toggleLoopback() {
  if (isActive) {
    stopLoopback();
  } else {
    await startLoopback();
  }
}

async function restartLoopback() {
  stopLoopback();
  // Brief delay to let everything settle
  setTimeout(startLoopback, 100);
}

async function startLoopback() {
  try {
    statusText.textContent = 'Connecting...';
    powerHint.textContent = 'Connecting microphone...';

    // Build constraints based on checkboxes and selected device
    const constraints = {
      audio: {
        echoCancellation: echoCancelCheckbox.checked,
        noiseSuppression: noiseSuppressCheckbox.checked,
        autoGainControl: autoGainCheckbox.checked,
      }
    };

    if (deviceSelect.value) {
      constraints.audio.deviceId = { exact: deviceSelect.value };
    }

    // Get permission and stream
    mediaStream = await navigator.mediaDevices.getUserMedia(constraints);

    // Refresh devices list so that labels are properly loaded after permission
    await requestDevicesList(false);

    // Setup Web Audio Graph with minimum latency configuration
    audioContext = new (window.AudioContext || window.webkitAudioContext)({
      latencyHint: 'interactive'
    });
    
    // Create nodes
    sourceNode = audioContext.createMediaStreamSource(mediaStream);
    analyserNode = audioContext.createAnalyser();
    gainNode = audioContext.createGain();

    // Set analyser parameters (large FFT size for a smooth, high-fidelity wave)
    analyserNode.fftSize = 2048;
    
    // Set initial gain
    const currentGain = volumeSlider.value / 100;
    gainNode.gain.setValueAtTime(currentGain, audioContext.currentTime);

    // Connect graph
    sourceNode.connect(analyserNode);
    analyserNode.connect(gainNode);
    gainNode.connect(audioContext.destination);

    // Update state & UI
    isActive = true;
    appCard.classList.add('active');
    statusText.textContent = 'Active Monitoring';
    powerHint.textContent = 'Click to stop loopback';

    // Start Visualizer loop
    startVisualizer();

  } catch (err) {
    console.error('Audio capture failed:', err);
    statusText.textContent = 'Error';
    powerHint.textContent = 'Microphone access denied or unavailable.';
    appCard.classList.remove('active');
    isActive = false;
    drawEmptyState();
  }
}

function stopLoopback() {
  isActive = false;
  appCard.classList.remove('active');
  statusText.textContent = 'System Ready';
  powerHint.textContent = 'Click to activate microphone';

  // Stop media stream tracks
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }

  // Cancel visualizer animation
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }

  // Close Audio Context
  if (audioContext) {
    audioContext.close().catch(() => {});
    audioContext = null;
  }

  // Clear references
  sourceNode = null;
  analyserNode = null;
  gainNode = null;

  drawEmptyState();
}

// Visualizer Rendering Loop
function startVisualizer() {
  const bufferLength = analyserNode.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  const draw = () => {
    if (!isActive || !analyserNode) return;

    animationFrameId = requestAnimationFrame(draw);

    // Fetch wave data
    analyserNode.getByteTimeDomainData(dataArray);

    // Clear Canvas
    canvasCtx.fillStyle = 'rgba(8, 9, 12, 0.2)'; // Slow decay for trailing glow effect
    canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

    // Set styling for the waveform line
    canvasCtx.lineWidth = 3 * window.devicePixelRatio;
    
    // Create gradient styling
    const gradient = canvasCtx.createLinearGradient(0, 0, canvas.width, 0);
    gradient.addColorStop(0, '#8b5cf6'); // Violet
    gradient.addColorStop(0.5, '#00f0ff'); // Cyan
    gradient.addColorStop(1, '#ec4899'); // Pink
    
    canvasCtx.strokeStyle = gradient;
    canvasCtx.shadowBlur = 15;
    canvasCtx.shadowColor = 'rgba(0, 240, 255, 0.5)';
    canvasCtx.beginPath();

    const sliceWidth = canvas.width / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * canvas.height) / 2;

      if (i === 0) {
        canvasCtx.moveTo(x, y);
      } else {
        canvasCtx.lineTo(x, y);
      }

      x += sliceWidth;
    }

    // Connect to right edge center line
    canvasCtx.lineTo(canvas.width, canvas.height / 2);
    canvasCtx.stroke();
    
    // Reset shadow for performance
    canvasCtx.shadowBlur = 0;
  };

  draw();
}

// Draw a flat center line when the monitor is inactive
function drawEmptyState() {
  canvasCtx.fillStyle = '#08090c';
  canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

  canvasCtx.lineWidth = 2 * window.devicePixelRatio;
  canvasCtx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  canvasCtx.beginPath();
  canvasCtx.moveTo(0, canvas.height / 2);
  canvasCtx.lineTo(canvas.width, canvas.height / 2);
  canvasCtx.stroke();
}
