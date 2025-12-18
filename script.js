// --- Global Variables ---
let originalImage = null;
let processedSketchMat = null;
const PREVIEW_MAX_WIDTH = 800;
const PREVIEW_MAX_HEIGHT = 600;
let isReady = false;
let textElements = [];
let activeTextIndex = null;

// --- DOM Elements ---
const statusElement = document.getElementById('status');
const fileInput = document.getElementById('fileInput');
const fileNameDisplay = document.getElementById('fileNameDisplay');
const tipSizeSlider = document.getElementById('tipSizeSlider');
const rangeSlider = document.getElementById('rangeSlider');
const tipSizeValue = document.getElementById('tipSizeValue');
const rangeValue = document.getElementById('rangeValue');
const imageCanvas = document.getElementById('imageCanvas');
const saveWhiteButton = document.getElementById('saveWhiteButton');
const saveBlackButton = document.getElementById('saveBlackButton');
const saveBothButton = document.getElementById('saveBothButton');
const textInputsContainer = document.getElementById('textInputs');
const addTextButton = document.getElementById('addTextButton');

// --- Initialization ---
Module = {
    onRuntimeInitialized: function() {
        if (typeof cv !== 'undefined') {
            statusElement.textContent = "OpenCV.js loaded. Ready.";
            isReady = true;
        } else {
            statusElement.textContent = "Error loading OpenCV.js.";
        }
        tipSizeValue.textContent = tipSizeSlider.value;
        rangeValue.textContent = rangeSlider.value;
        addEventListeners();
    }
};

function addEventListeners() {
    fileInput.addEventListener('change', handleFileSelect);
    tipSizeSlider.addEventListener('input', scheduleUpdate);
    rangeSlider.addEventListener('input', scheduleUpdate);
    saveWhiteButton.addEventListener('click', () => saveSketch('white'));
    saveBlackButton.addEventListener('click', () => saveSketch('black'));
    saveBothButton.addEventListener('click', () => { saveSketch('white'); saveSketch('black'); });
    addTextButton.addEventListener('click', addTextElement);
    
    // Canvas Click for positioning
    imageCanvas.addEventListener('mousedown', handleCanvasClick);
}

// --- Image Processing ---

function adjustLevels(srcMat, lower_bound, upper_bound) {
    lower_bound = Math.max(0, Math.min(255, lower_bound));
    upper_bound = Math.max(0, Math.min(255, upper_bound));
    if (lower_bound >= upper_bound) return srcMat.clone();

    let lut = new cv.Mat(1, 256, cv.CV_8UC1);
    let data = lut.data;
    for (let i = 0; i < 256; i++) {
        if (i <= lower_bound) data[i] = 0;
        else if (i >= upper_bound) data[i] = 255;
        else data[i] = Math.round(((i - lower_bound) / (upper_bound - lower_bound)) * 255);
    }
    let dst = new cv.Mat();
    cv.LUT(srcMat, lut, dst);
    lut.delete();
    return dst;
}

function createPencilSketch(imgMat, pencil_tip_size, range_param) {
    if (!isReady || !imgMat || imgMat.empty()) return null;

    let grayImg = new cv.Mat();
    cv.cvtColor(imgMat, grayImg, cv.COLOR_RGBA2GRAY, 0);

    let invertedGrayImg = new cv.Mat();
    cv.bitwise_not(grayImg, invertedGrayImg);

    let kernelSize = parseInt(pencil_tip_size);
    if (kernelSize % 2 === 0) kernelSize += 1;
    
    let blurredImg = new cv.Mat();
    cv.GaussianBlur(invertedGrayImg, blurredImg, new cv.Size(kernelSize, kernelSize), 0);
    
    let invertedBlurredImg = new cv.Mat();
    cv.bitwise_not(blurredImg, invertedBlurredImg);
    
    let pencilSketch = new cv.Mat();
    cv.divide(grayImg, invertedBlurredImg, pencilSketch, 256.0);

    const contrastFactor = 20;
    const lowerBound = 0 - (range_param * contrastFactor);
    const upperBound = 255 + (range_param * contrastFactor);
    
    let finalSketch = adjustLevels(pencilSketch, lowerBound, upperBound);
    
    grayImg.delete(); invertedGrayImg.delete(); blurredImg.delete(); 
    invertedBlurredImg.delete(); pencilSketch.delete();

    return finalSketch;
}

// --- Text Logic ---

function addTextElement() {
    const id = Date.now();
    const index = textElements.length;

    const div = document.createElement('div');
    div.className = 'text-item';
    div.id = `container-${id}`;
    div.innerHTML = `
        <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
            <label>Text #${index + 1}</label>
            <button class="delete-btn" onclick="removeTextElement(${id})">Delete</button>
        </div>
        <input type="text" placeholder="Your text here..." id="text-${id}" oninput="scheduleUpdate()" onfocus="activeTextIndex = ${id}">
        <div class="text-row">
            <label>X:</label><input type="number" id="x-${id}" value="50" oninput="scheduleUpdate()">
            <label>Y:</label><input type="number" id="y-${id}" value="50" oninput="scheduleUpdate()">
            <label>Size:</label><input type="number" id="size-${id}" value="40" oninput="scheduleUpdate()">
        </div>
        <div class="text-row">
            <select id="color-${id}" onchange="scheduleUpdate()">
                <option value="white">White Text</option>
                <option value="black">Black Text</option>
            </select>
            <select id="outline-${id}" onchange="scheduleUpdate()">
                <option value="none">No Outline</option>
                <option value="opposite">Outline</option>
            </select>
        </div>
    `;
    textInputsContainer.appendChild(div);

    textElements.push({
        id: id,
        textId: `text-${id}`,
        xId: `x-${id}`,
        yId: `y-${id}`,
        sizeId: `size-${id}`,
        colorId: `color-${id}`,
        outlineId: `outline-${id}`
    });
    
    activeTextIndex = id;
    scheduleUpdate();
}

function removeTextElement(id) {
    textElements = textElements.filter(el => el.id !== id);
    document.getElementById(`container-${id}`).remove();
    scheduleUpdate();
}

function handleCanvasClick(e) {
    if (activeTextIndex === null || textElements.length === 0) return;

    const rect = imageCanvas.getBoundingClientRect();
    const scaleX = imageCanvas.width / rect.width;
    const scaleY = imageCanvas.height / rect.height;
    
    // Get mouse position relative to canvas
    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);

    // Find the active element inputs
    const xInput = document.getElementById(`x-${activeTextIndex}`);
    const yInput = document.getElementById(`y-${activeTextIndex}`);
    
    if (xInput && yInput) {
        xInput.value = x;
        yInput.value = y;
        scheduleUpdate();
    }
}

function applyTexts(ctx, scale = 1) {
    textElements.forEach(el => {
        const text = document.getElementById(el.textId).value;
        const x = parseInt(document.getElementById(el.xId).value) * scale;
        const y = parseInt(document.getElementById(el.yId).value) * scale;
        const size = parseInt(document.getElementById(el.sizeId).value) * scale;
        const color = document.getElementById(el.colorId).value;
        const outline = document.getElementById(el.outlineId).value;

        if (text) {
            ctx.font = `bold ${size}px Arial`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";

            if (outline === 'opposite') {
                ctx.strokeStyle = color === 'white' ? 'black' : 'white';
                ctx.lineWidth = Math.max(2, size / 10);
                ctx.strokeText(text, x, y);
            }

            ctx.fillStyle = color;
            ctx.fillText(text, x, y);
        }
    });
}

// --- UI Updates ---

let updateJob = null;
function scheduleUpdate() {
    tipSizeValue.textContent = tipSizeSlider.value;
    rangeValue.textContent = rangeSlider.value;
    
    if (originalImage) {
        if (updateJob) clearTimeout(updateJob);
        updateJob = setTimeout(updatePreview, 50);
    }
}

function handleFileSelect(e) {
    if (!isReady || e.target.files.length === 0) return;
    const file = e.target.files[0];
    fileNameDisplay.textContent = file.name;

    const img = new Image();
    img.onload = () => {
        if (originalImage) originalImage.delete();
        originalImage = cv.imread(img);
        updatePreview();
    };
    img.src = URL.createObjectURL(file);
}

function updatePreview() {
    if (!originalImage || originalImage.empty()) return;

    const tipSize = parseFloat(tipSizeSlider.value);
    const rangeParam = parseFloat(rangeSlider.value);

    if (processedSketchMat) processedSketchMat.delete();
    processedSketchMat = createPencilSketch(originalImage, tipSize, rangeParam);

    // Create preview mat
    let previewMat = new cv.Mat();
    const ratio = Math.min(PREVIEW_MAX_WIDTH / originalImage.cols, PREVIEW_MAX_HEIGHT / originalImage.rows);
    const newWidth = Math.round(originalImage.cols * ratio);
    const newHeight = Math.round(originalImage.rows * ratio);
    
    cv.resize(processedSketchMat, previewMat, new cv.Size(newWidth, newHeight));

    imageCanvas.width = newWidth;
    imageCanvas.height = newHeight;
    
    // Draw sketch to canvas
    cv.imshow('imageCanvas', previewMat);
    
    // Apply Text Overlays via 2D Context
    const ctx = imageCanvas.getContext('2d');
    applyTexts(ctx);

    previewMat.delete();
    statusElement.textContent = "Preview updated.";
}

// --- Export Logic ---

function saveSketch(mode) {
    if (!processedSketchMat) return;

    // 1. Create the Alpha mask from the sketch
    let alphaMat = new cv.Mat();
    let scalar255 = new cv.Mat(processedSketchMat.rows, processedSketchMat.cols, cv.CV_8UC1, new cv.Scalar(255));
    cv.subtract(scalar255, processedSketchMat, alphaMat);
    
    // 2. Create high-res offscreen canvas
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = processedSketchMat.cols;
    exportCanvas.height = processedSketchMat.rows;
    const ctx = exportCanvas.getContext('2d');

    // 3. Fill based on mode
    ctx.clearRect(0, 0, exportCanvas.width, exportCanvas.height);
    
    // Create image data for the transparency mask
    let imgData = ctx.createImageData(exportCanvas.width, exportCanvas.height);
    let color = (mode === 'white') ? 0 : 255; // Black sketch for white bg, White sketch for black bg

    for (let i = 0; i < alphaMat.data.length; i++) {
        const idx = i * 4;
        imgData.data[idx] = color;     // R
        imgData.data[idx + 1] = color; // G
        imgData.data[idx + 2] = color; // B
        imgData.data[idx + 3] = alphaMat.data[i]; // A
    }
    ctx.putImageData(imgData, 0, 0);

    // 4. Apply text to the export canvas (at full resolution)
    // We scale the text positions from preview size to original size
    const scale = 1; // Our text coordinates are stored in 'original image' space relative to the preview
    // Note: Since we used the preview canvas width/height for X/Y, we need to scale them back up
    const ratio = exportCanvas.width / imageCanvas.width;
    applyTexts(ctx, ratio);

    // 5. Download
    const link = document.createElement('a');
    link.download = `bait_${mode}.png`;
    link.href = exportCanvas.toDataURL("image/png");
    link.click();

    alphaMat.delete();
    scalar255.delete();
}
