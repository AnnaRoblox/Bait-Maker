// --- Global Variables ---
let originalImage = null;
let processedSketchMat = null;
const PREVIEW_MAX_WIDTH = 800;
const PREVIEW_MAX_HEIGHT = 600;
let isReady = false;
let textElements = [];
let activeTextId = null;

// --- DOM Elements ---
const statusElement = document.getElementById('status');
const fileInput = document.getElementById('fileInput');
const tipSizeSlider = document.getElementById('tipSizeSlider');
const rangeSlider = document.getElementById('rangeSlider');
const imageCanvas = document.getElementById('imageCanvas');
const textInputsContainer = document.getElementById('textInputs');

// --- Initialization ---
Module = {
    onRuntimeInitialized: function() {
        if (typeof cv !== 'undefined') {
            statusElement.textContent = "OpenCV loaded. Ready to work!";
            isReady = true;
        }
        addEventListeners();
    }
};

function addEventListeners() {
    fileInput.addEventListener('change', handleFileSelect);
    tipSizeSlider.addEventListener('input', scheduleUpdate);
    rangeSlider.addEventListener('input', scheduleUpdate);
    document.getElementById('saveWhiteButton').addEventListener('click', () => saveSketch('white'));
    document.getElementById('saveBlackButton').addEventListener('click', () => saveSketch('black'));
    document.getElementById('saveBothButton').addEventListener('click', () => { saveSketch('white'); saveSketch('black'); });
    document.getElementById('addTextButton').addEventListener('click', addTextElement);
    imageCanvas.addEventListener('mousedown', handleCanvasClick);
}

// --- CORE IMAGE PROCESSING ---

function createPencilSketch(imgMat, tipSize, rangeParam) {
    if (!isReady || !imgMat || imgMat.empty()) return null;

    let gray = new cv.Mat();
    cv.cvtColor(imgMat, gray, cv.COLOR_RGBA2GRAY);

    let invGray = new cv.Mat();
    cv.bitwise_not(gray, invGray);

    let kSize = parseInt(tipSize);
    if (kSize % 2 === 0) kSize += 1;
    
    let blurred = new cv.Mat();
    cv.GaussianBlur(invGray, blurred, new cv.Size(kSize, kSize), 0);
    
    let invBlurred = new cv.Mat();
    cv.bitwise_not(blurred, invBlurred);
    
    let sketch = new cv.Mat();
    cv.divide(gray, invBlurred, sketch, 256.0);

    // Level adjustment
    const contrast = 20;
    const low = 0 - (rangeParam * contrast);
    const high = 255 + (rangeParam * contrast);
    
    let lut = new cv.Mat(1, 256, cv.CV_8UC1);
    for (let i = 0; i < 256; i++) {
        if (i <= low) lut.data[i] = 0;
        else if (i >= high) lut.data[i] = 255;
        else lut.data[i] = Math.round(((i - low) / (high - low)) * 255);
    }
    
    let finalSketch = new cv.Mat();
    cv.LUT(sketch, lut, finalSketch);

    // Cleanup
    gray.delete(); invGray.delete(); blurred.delete(); 
    invBlurred.delete(); sketch.delete(); lut.delete();

    return finalSketch;
}

// --- TEXT MANAGEMENT ---

function addTextElement() {
    const id = Date.now();
    const div = document.createElement('div');
    div.className = 'text-item';
    div.id = `item-${id}`;
    div.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong style="font-size:0.8em">Text Layer</strong>
            <button class="delete-btn" onclick="removeText(${id})">✕</button>
        </div>
        <input type="text" id="t-${id}" placeholder="Enter text..." oninput="scheduleUpdate()" onfocus="activeTextId = ${id}">
        <div class="text-row">
            <input type="number" id="s-${id}" value="60" title="Font Size" oninput="scheduleUpdate()">
            <select id="m-${id}" onchange="scheduleUpdate()">
                <option value="bait">Solid Bait</option>
                <option value="erase">Eraser</option>
            </select>
        </div>
        <input type="hidden" id="x-${id}" value="50">
        <input type="hidden" id="y-${id}" value="50">
    `;
    textInputsContainer.appendChild(div);
    textElements.push(id);
    activeTextId = id;
    
    // Default position to center
    if (originalImage) {
        document.getElementById(`x-${id}`).value = Math.round(originalImage.cols / 2);
        document.getElementById(`y-${id}`).value = Math.round(originalImage.rows / 2);
    }
    
    scheduleUpdate();
}

function removeText(id) {
    textElements = textElements.filter(tid => tid !== id);
    document.getElementById(`item-${id}`).remove();
    if (activeTextId === id) activeTextId = null;
    scheduleUpdate();
}

function handleCanvasClick(e) {
    if (!activeTextId || !originalImage) return;

    const rect = imageCanvas.getBoundingClientRect();
    const scaleX = originalImage.cols / rect.width;
    const scaleY = originalImage.rows / rect.height;
    
    document.getElementById(`x-${activeTextId}`).value = Math.round((e.clientX - rect.left) * scaleX);
    document.getElementById(`y-${activeTextId}`).value = Math.round((e.clientY - rect.top) * scaleY);
    
    scheduleUpdate();
}

/**
 * This is the crucial part: drawing text into the OpenCV mat 
 * so it inherits the transparency logic.
 */
function burnTextToMat(targetMat) {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = targetMat.cols;
    tempCanvas.height = targetMat.rows;
    const ctx = tempCanvas.getContext('2d');

    textElements.forEach(id => {
        const text = document.getElementById(`t-${id}`).value;
        const x = parseInt(document.getElementById(`x-${id}`).value);
        const y = parseInt(document.getElementById(`y-${id}`).value);
        const size = parseInt(document.getElementById(`s-${id}`).value);
        const mode = document.getElementById(`m-${id}`).value;

        if (text) {
            ctx.font = `bold ${size}px Arial`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            // In the sketch mat: 0 = Black (becomes opaque bait), 255 = White (becomes transparent)
            ctx.fillStyle = (mode === 'bait') ? "black" : "white";
            ctx.fillText(text, x, y);
        }
    });

    // Blend the canvas text onto the Mat
    let textMat = cv.imread(tempCanvas);
    let grayText = new cv.Mat();
    cv.cvtColor(textMat, grayText, cv.COLOR_RGBA2GRAY);

    // Only update pixels where text was actually drawn
    // We use a simple minimum to "burn" black text into the sketch
    for (let row = 0; row < targetMat.rows; row++) {
        for (let col = 0; col < targetMat.cols; col++) {
            let textPixel = grayText.ucharPtr(row, col)[0];
            // If the text canvas isn't empty here
            if (textPixel < 255) { 
                targetMat.ucharPtr(row, col)[0] = textPixel;
            }
        }
    }

    textMat.delete(); grayText.delete();
}

// --- UI & UPDATES ---

let updateTimer = null;
function scheduleUpdate() {
    document.getElementById('tipSizeValue').textContent = tipSizeSlider.value;
    document.getElementById('rangeValue').textContent = rangeSlider.value;
    if (updateTimer) clearTimeout(updateTimer);
    updateTimer = setTimeout(updatePreview, 100);
}

function handleFileSelect(e) {
    if (e.target.files.length === 0) return;
    const img = new Image();
    img.onload = () => {
        if (originalImage) originalImage.delete();
        originalImage = cv.imread(img);
        updatePreview();
    };
    img.src = URL.createObjectURL(e.target.files[0]);
    document.getElementById('fileNameDisplay').textContent = e.target.files[0].name;
}

function updatePreview() {
    if (!originalImage) return;

    if (processedSketchMat) processedSketchMat.delete();
    processedSketchMat = createPencilSketch(originalImage, tipSizeSlider.value, rangeSlider.value);
    
    // Apply texts to the sketch mat
    burnTextToMat(processedSketchMat);

    // Prepare for display (convert to RGBA)
    let displayMat = new cv.Mat();
    const ratio = Math.min(PREVIEW_MAX_WIDTH / originalImage.cols, PREVIEW_MAX_HEIGHT / originalImage.rows);
    cv.resize(processedSketchMat, displayMat, new cv.Size(Math.round(originalImage.cols * ratio), Math.round(originalImage.rows * ratio)));

    imageCanvas.width = displayMat.cols;
    imageCanvas.height = displayMat.rows;
    cv.imshow('imageCanvas', displayMat);
    
    displayMat.delete();
    statusElement.textContent = "Preview Updated";
}

function saveSketch(mode) {
    if (!processedSketchMat) return;

    const width = processedSketchMat.cols;
    const height = processedSketchMat.rows;
    
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = width;
    exportCanvas.height = height;
    const ctx = exportCanvas.getContext('2d');
    
    const imgData = ctx.createImageData(width, height);
    const sketchData = processedSketchMat.data;
    const color = (mode === 'white') ? 0 : 255; 

    for (let i = 0; i < sketchData.length; i++) {
        const idx = i * 4;
        imgData.data[idx] = color;     // R
        imgData.data[idx + 1] = color; // G
        imgData.data[idx + 2] = color; // B
        imgData.data[idx + 3] = 255 - sketchData[i]; // Alpha: Darker sketch = More opaque
    }

    ctx.putImageData(imgData, 0, 0);
    
    const link = document.createElement('a');
    link.download = `bait_${mode}.png`;
    link.href = exportCanvas.toDataURL("image/png");
    link.click();
}
