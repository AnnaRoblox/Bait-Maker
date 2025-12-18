// --- Global Variables ---
let originalImage = null;
let processedSketchMat = null;
const PREVIEW_MAX_WIDTH = 800;
const PREVIEW_MAX_HEIGHT = 600;
let isReady = false;
let textElements = [];
let activeTextIndex = null;

// --- Initialization ---
Module = {
    onRuntimeInitialized: function() {
        if (typeof cv !== 'undefined') {
            statusElement.textContent = "OpenCV.js loaded. Ready.";
            isReady = true;
        }
        addEventListeners();
    }
};

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

function addEventListeners() {
    fileInput.addEventListener('change', handleFileSelect);
    tipSizeSlider.addEventListener('input', scheduleUpdate);
    rangeSlider.addEventListener('input', scheduleUpdate);
    saveWhiteButton.addEventListener('click', () => saveSketch('white'));
    saveBlackButton.addEventListener('click', () => saveSketch('black'));
    saveBothButton.addEventListener('click', () => { saveSketch('white'); saveSketch('black'); });
    addTextButton.addEventListener('click', addTextElement);
    imageCanvas.addEventListener('mousedown', handleCanvasClick);
}

// --- Image Processing ---

function adjustLevels(srcMat, lower_bound, upper_bound) {
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
    let kernelSize = Math.max(1, parseInt(pencil_tip_size));
    if (kernelSize % 2 === 0) kernelSize += 1;
    let blurredImg = new cv.Mat();
    cv.GaussianBlur(invertedGrayImg, blurredImg, new cv.Size(kernelSize, kernelSize), 0);
    let invertedBlurredImg = new cv.Mat();
    cv.bitwise_not(blurredImg, invertedBlurredImg);
    let pencilSketch = new cv.Mat();
    cv.divide(grayImg, invertedBlurredImg, pencilSketch, 256.0);
    const contrastFactor = 20;
    let finalSketch = adjustLevels(pencilSketch, 0 - (range_param * contrastFactor), 255 + (range_param * contrastFactor));
    grayImg.delete(); invertedGrayImg.delete(); blurredImg.delete(); invertedBlurredImg.delete(); pencilSketch.delete();
    return finalSketch;
}

// --- Text Management ---

function addTextElement() {
    const id = Date.now();
    const div = document.createElement('div');
    div.className = 'text-item';
    div.id = `container-${id}`;
    div.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
            <label style="color:#007bff">Text Layer</label>
            <button class="delete-btn" onclick="removeTextElement(${id})">Remove</button>
        </div>
        <input type="text" placeholder="Type here..." id="text-${id}" oninput="scheduleUpdate()" onfocus="activeTextIndex = ${id}">
        <div class="text-row">
            <label>X:</label><input type="number" id="x-${id}" value="150" style="width:50px" oninput="scheduleUpdate()">
            <label>Y:</label><input type="number" id="y-${id}" value="150" style="width:50px" oninput="scheduleUpdate()">
            <label>Size:</label><input type="number" id="size-${id}" value="40" style="width:45px" oninput="scheduleUpdate()">
        </div>
        <div class="text-row">
            <label>Color:</label>
            <select id="color-${id}" onchange="scheduleUpdate()">
                <option value="black">Black</option>
                <option value="white">White</option>
            </select>
            <label>Outline:</label>
            <select id="outline-${id}" onchange="scheduleUpdate()">
                <option value="none">None</option>
                <option value="black">black Outline</option>
                <option value="white">White Outline</option>
            </select>
        </div>
    `;
    textInputsContainer.appendChild(div);
    textElements.push({ id, textId: `text-${id}`, xId: `x-${id}`, yId: `y-${id}`, sizeId: `size-${id}`, colorId: `color-${id}`, outlineId: `outline-${id}` });
    activeTextIndex = id;
    scheduleUpdate();
}

function removeTextElement(id) {
    textElements = textElements.filter(el => el.id !== id);
    document.getElementById(`container-${id}`).remove();
    scheduleUpdate();
}

function handleCanvasClick(e) {
    if (activeTextIndex === null) return;
    const rect = imageCanvas.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left) * (imageCanvas.width / rect.width));
    const y = Math.round((e.clientY - rect.top) * (imageCanvas.height / rect.height));
    document.getElementById(`x-${activeTextIndex}`).value = x;
    document.getElementById(`y-${activeTextIndex}`).value = y;
    scheduleUpdate();
}

/**
 * Renders text onto a context. 
 * 'black' on the grayscale map = opaque ink.
 * 'white' on the grayscale map = transparent knockout.
 */
function renderTextToMap(ctx, scale) {
    textElements.forEach(el => {
        const text = document.getElementById(el.textId).value;
        if (!text) return;
        
        const x = parseInt(document.getElementById(el.xId).value) * scale;
        const y = parseInt(document.getElementById(el.yId).value) * scale;
        const size = parseInt(document.getElementById(el.sizeId).value) * scale;
        const color = document.getElementById(el.colorId).value;
        const outline = document.getElementById(el.outlineId).value;

        ctx.font = `bold ${size}px Arial`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        if (outline !== 'none') {
            ctx.strokeStyle = (outline === 'white') ? "white" : "black";
            ctx.lineWidth = Math.max(2, size / 8);
            ctx.strokeText(text, x, y);
        }

        ctx.fillStyle = (color === 'white') ? "white" : "black";
        ctx.fillText(text, x, y);
    });
}

// --- Updates & Previews ---

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
    if (e.target.files.length === 0) return;
    const img = new Image();
    img.onload = () => {
        if (originalImage) originalImage.delete();
        originalImage = cv.imread(img);
        updatePreview();
    };
    img.src = URL.createObjectURL(e.target.files[0]);
}

function updatePreview() {
    if (!originalImage) return;
    if (processedSketchMat) processedSketchMat.delete();
    processedSketchMat = createPencilSketch(originalImage, tipSizeSlider.value, rangeSlider.value);

    const ratio = Math.min(PREVIEW_MAX_WIDTH / originalImage.cols, PREVIEW_MAX_HEIGHT / originalImage.rows);
    const w = Math.round(originalImage.cols * ratio);
    const h = Math.round(originalImage.rows * ratio);
    
    let previewMat = new cv.Mat();
    cv.resize(processedSketchMat, previewMat, new cv.Size(w, h));
    imageCanvas.width = w; imageCanvas.height = h;
    cv.imshow('imageCanvas', previewMat);
    
    const ctx = imageCanvas.getContext('2d');
    renderTextToMap(ctx, 1);
    previewMat.delete();
}

// --- Download Logic ---

function saveSketch(mode) {
    if (!processedSketchMat) return;
    
    const workCanvas = document.createElement('canvas');
    workCanvas.width = processedSketchMat.cols;
    workCanvas.height = processedSketchMat.rows;
    const workCtx = workCanvas.getContext('2d');
    
    // Draw grayscale sketch
    cv.imshow(workCanvas, processedSketchMat);
    
    // Draw text on grayscale map (scaled up)
    renderTextToMap(workCtx, workCanvas.width / imageCanvas.width);

    const combinedData = workCtx.getImageData(0, 0, workCanvas.width, workCanvas.height);
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = workCanvas.width; finalCanvas.height = workCanvas.height;
    const finalCtx = finalCanvas.getContext('2d');
    const finalImgData = finalCtx.createImageData(finalCanvas.width, finalCanvas.height);

    const ink = (mode === 'white') ? 0 : 255; 

    for (let i = 0; i < combinedData.data.length; i += 4) {
        const gray = combinedData.data[i]; 
        finalImgData.data[i] = ink;
        finalImgData.data[i+1] = ink;
        finalImgData.data[i+2] = ink;
        finalImgData.data[i+3] = 255 - gray; // Convert grayscale to Alpha
    }

    finalCtx.putImageData(finalImgData, 0, 0);
    const link = document.createElement('a');
    link.download = `bait_${mode}.png`;
    link.href = finalCanvas.toDataURL("image/png");
    link.click();
}
