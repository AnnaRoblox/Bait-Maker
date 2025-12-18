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
    imageCanvas.addEventListener('mousedown', handleCanvasClick);
}

// --- Image Processing Logic ---

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

// --- Text Management ---

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
        <input type="text" placeholder="Enter text..." id="text-${id}" oninput="scheduleUpdate()" onfocus="activeTextIndex = ${id}">
        <div class="text-row">
            <label>X:</label><input type="number" id="x-${id}" value="100" oninput="scheduleUpdate()">
            <label>Y:</label><input type="number" id="y-${id}" value="100" oninput="scheduleUpdate()">
            <label>Size:</label><input type="number" id="size-${id}" value="50" oninput="scheduleUpdate()">
        </div>
    `;
    textInputsContainer.appendChild(div);

    textElements.push({
        id: id,
        textId: `text-${id}`,
        xId: `x-${id}`,
        yId: `y-${id}`,
        sizeId: `size-${id}`
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
    
    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);

    const xInput = document.getElementById(`x-${activeTextIndex}`);
    const yInput = document.getElementById(`y-${activeTextIndex}`);
    
    if (xInput && yInput) {
        xInput.value = x;
        yInput.value = y;
        scheduleUpdate();
    }
}

/**
 * Renders the text onto a context.
 * IMPORTANT: To make the text "baitable," we draw it in Black or White 
 * on the grayscale map.
 */
function renderTextToMap(ctx, scale, mode = 'preview') {
    textElements.forEach(el => {
        const text = document.getElementById(el.textId).value;
        const x = parseInt(document.getElementById(el.xId).value) * scale;
        const y = parseInt(document.getElementById(el.yId).value) * scale;
        const size = parseInt(document.getElementById(el.sizeId).value) * scale;

        if (text) {
            ctx.font = `bold ${size}px Arial`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            
            // To appear in the final "bait", text must be DARK on the grayscale map
            // because the alpha channel is calculated as (255 - grayscale_value).
            ctx.fillStyle = "black"; 
            ctx.fillText(text, x, y);
        }
    });
}

// --- UI Logic ---

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

    const ratio = Math.min(PREVIEW_MAX_WIDTH / originalImage.cols, PREVIEW_MAX_HEIGHT / originalImage.rows);
    const newWidth = Math.round(originalImage.cols * ratio);
    const newHeight = Math.round(originalImage.rows * ratio);
    
    let previewMat = new cv.Mat();
    cv.resize(processedSketchMat, previewMat, new cv.Size(newWidth, newHeight));

    imageCanvas.width = newWidth;
    imageCanvas.height = newHeight;
    
    // Draw base sketch
    cv.imshow('imageCanvas', previewMat);
    
    // Draw Text onto the same grayscale canvas so it "merges" with the sketch
    const ctx = imageCanvas.getContext('2d');
    renderTextToMap(ctx, 1);

    previewMat.delete();
}

// --- Bait Generation (Download) ---

function saveSketch(mode) {
    if (!processedSketchMat) return;

    // 1. Create a workspace canvas at full resolution
    const workCanvas = document.createElement('canvas');
    workCanvas.width = processedSketchMat.cols;
    workCanvas.height = processedSketchMat.rows;
    const workCtx = workCanvas.getContext('2d');

    // 2. Draw the grayscale sketch onto the work canvas
    cv.imshow(workCanvas, processedSketchMat);

    // 3. Bake the text into this grayscale map at full resolution
    const exportScale = workCanvas.width / imageCanvas.width;
    renderTextToMap(workCtx, exportScale);

    // 4. Get the combined pixel data (Sketch + Text)
    const combinedData = workCtx.getImageData(0, 0, workCanvas.width, workCanvas.height);
    
    // 5. Create the final Bait Image
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = workCanvas.width;
    finalCanvas.height = workCanvas.height;
    const finalCtx = finalCanvas.getContext('2d');
    const finalImgData = finalCtx.createImageData(finalCanvas.width, finalCanvas.height);

    const inkColor = (mode === 'white') ? 0 : 255; // Black ink for white theme, White ink for dark theme

    for (let i = 0; i < combinedData.data.length; i += 4) {
        // We use the Red channel of our baked grayscale map to determine transparency
        const grayValue = combinedData.data[i]; 
        const alpha = 255 - grayValue;

        finalImgData.data[i] = inkColor;     // R
        finalImgData.data[i + 1] = inkColor; // G
        finalImgData.data[i + 2] = inkColor; // B
        finalImgData.data[i + 3] = alpha;    // Alpha
    }

    finalCtx.putImageData(finalImgData, 0, 0);

    // 6. Trigger Download
    const link = document.createElement('a');
    link.download = `bait_${mode}.png`;
    link.href = finalCanvas.toDataURL("image/png");
    link.click();
}
