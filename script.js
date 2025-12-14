// --- Global Variables ---
let originalImage = null;
let processedSketchMat = null;
const PREVIEW_MAX_WIDTH = 600;
const PREVIEW_MAX_HEIGHT = 500;
let isReady = false;

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

// --- OpenCV Ready Function (Corrected Initialization) ---
Module = {
    // This hook ensures that the code runs ONLY when OpenCV is fully loaded and ready.
    onRuntimeInitialized: function() {
        if (typeof cv !== 'undefined') {
            statusElement.textContent = "OpenCV.js loaded. Ready to process.";
            isReady = true;
        } else {
            statusElement.textContent = "Error loading OpenCV.js.";
        }
        // Set initial slider values and wire up listeners
        tipSizeValue.textContent = tipSizeSlider.value;
        rangeValue.textContent = rangeSlider.value;
        addEventListeners();
    }
};


// --- CORE IMAGE PROCESSING LOGIC ---

function adjustLevels(srcMat, lower_bound, upper_bound) {
    lower_bound = Math.max(0, Math.min(255, lower_bound));
    upper_bound = Math.max(0, Math.min(255, upper_bound));

    if (lower_bound >= upper_bound) {
        return srcMat.clone();
    }

    let lut = new cv.Mat(1, 256, cv.CV_8UC1);
    let data = lut.data;

    for (let i = 0; i < 256; i++) {
        let val;
        if (i <= lower_bound) {
            val = 0;
        } else if (i >= upper_bound) {
            val = 255;
        } else {
            val = Math.round(((i - lower_bound) / (upper_bound - lower_bound)) * 255);
        }
        data[i] = val;
    }

    let dst = new cv.Mat();
    cv.LUT(srcMat, lut, dst);
    lut.delete();
    return dst;
}

function createPencilSketch(imgMat, pencil_tip_size, range_param) {
    if (!isReady || !imgMat || imgMat.empty()) {
        statusElement.textContent = "Error: Invalid image or OpenCV not ready.";
        return null;
    }

    // --- 1. Convert to Grayscale ---
    let grayImg = new cv.Mat();
    cv.cvtColor(imgMat, grayImg, cv.COLOR_RGBA2GRAY, 0);

    // --- 2. Invert Grayscale ---
    let invertedGrayImg = new cv.Mat();
    let scalar255 = new cv.Mat(grayImg.rows, grayImg.cols, grayImg.type(), new cv.Scalar(255));
    cv.subtract(scalar255, grayImg, invertedGrayImg);
    scalar255.delete();

    // --- 3. Blur the Inverted Image ---
    let kernelSize = parseInt(pencil_tip_size);
    if (kernelSize % 2 === 0) {
        kernelSize += 1;
    }
    let blurredImg = new cv.Mat();
    let ksize = new cv.Size(kernelSize, kernelSize);
    cv.GaussianBlur(invertedGrayImg, blurredImg, ksize, 0, 0, cv.BORDER_DEFAULT);
    
    // --- 4. Invert the Blurred Image ---
    let invertedBlurredImg = new cv.Mat();
    let scalar255_2 = new cv.Mat(blurredImg.rows, blurredImg.cols, blurredImg.type(), new cv.Scalar(255));
    cv.subtract(scalar255_2, blurredImg, invertedBlurredImg);
    scalar255_2.delete();
    
    // --- 5. Division Blend ---
    let pencilSketch = new cv.Mat();
    cv.divide(grayImg, invertedBlurredImg, pencilSketch, 256.0);

    // --- 6. Adjust Levels (Contrast/Range) ---
    const contrastFactor = 20;
    const lowerBound = 0 - (range_param * contrastFactor);
    const upperBound = 255 + (range_param * contrastFactor);
    
    let finalSketch = adjustLevels(pencilSketch, lowerBound, upperBound);
    
    // Clean up temporary Mats
    grayImg.delete();
    invertedGrayImg.delete();
    blurredImg.delete();
    invertedBlurredImg.delete();
    pencilSketch.delete();

    return finalSketch;
}

// --- UI AND EVENT HANDLERS ---

function addEventListeners() {
    fileInput.addEventListener('change', handleFileSelect);
    // These listeners trigger the update job only if an image is loaded
    tipSizeSlider.addEventListener('input', scheduleUpdate);
    rangeSlider.addEventListener('input', scheduleUpdate);
    saveWhiteButton.addEventListener('click', () => saveSketch('white'));
    saveBlackButton.addEventListener('click', () => saveSketch('black'));
    saveBothButton.addEventListener('click', () => { saveSketch('white'); saveSketch('black'); });
}

function handleFileSelect(e) {
    if (!isReady || e.target.files.length === 0) return;

    const file = e.target.files[0];
    fileNameDisplay.textContent = file.name;
    statusElement.textContent = `File loaded: ${file.name}. Processing...`;

    const img = new Image();
    img.onload = () => {
        // --- CLEANUP OF PREVIOUS MATS ---
        if (originalImage && !originalImage.isDeleted()) originalImage.delete();
        if (processedSketchMat && !processedSketchMat.isDeleted()) processedSketchMat.delete();

        // Load the image into an OpenCV Mat (RGBA)
        let mat = cv.imread(img);
        originalImage = mat; // Set the global originalImage variable
        
        // Update the preview
        updatePreview();
    };
    img.src = URL.createObjectURL(file);
}

// Simple debouncing for slider updates
let updateJob = null;
function scheduleUpdate() {
    tipSizeValue.textContent = tipSizeSlider.value;
    rangeValue.textContent = rangeSlider.value;
    
    // The check is here: ONLY schedule an update if an image is loaded
    if (originalImage && !originalImage.empty()) {
        statusElement.textContent = "Parameters changed. Processing preview...";
        if (updateJob) {
            clearTimeout(updateJob);
        }
        updateJob = setTimeout(updatePreview, 150);
    }
}

function updatePreview() {
    // Check if originalImage is properly set before proceeding
    if (!originalImage || originalImage.empty() || originalImage.isDeleted()) {
        statusElement.textContent = "Error: Original image Mat is not ready.";
        return;
    }

    const tipSize = parseFloat(tipSizeSlider.value);
    const rangeParam = parseFloat(rangeSlider.value);

    // --- 1. Generate Sketch ---
    // Safely delete the previous processed sketch before generating a new one
    if (processedSketchMat && !processedSketchMat.isDeleted()) processedSketchMat.delete();
    
    processedSketchMat = createPencilSketch(originalImage, tipSize, rangeParam);

    if (!processedSketchMat) {
        statusElement.textContent = "Error generating sketch.";
        return;
    }

    // --- 2. Prepare for Canvas Display ---
    let sketchRGB = new cv.Mat();
    cv.cvtColor(processedSketchMat, sketchRGB, cv.COLOR_GRAY2RGBA, 0);

    // Resize the image to fit the preview canvas
    const ratio = Math.min(PREVIEW_MAX_WIDTH / sketchRGB.cols, PREVIEW_MAX_HEIGHT / sketchRGB.rows);
    const newWidth = Math.round(sketchRGB.cols * ratio);
    const newHeight = Math.round(sketchRGB.rows * ratio);

    let resizedSketch = new cv.Mat();
    let size = new cv.Size(newWidth, newHeight);
    cv.resize(sketchRGB, resizedSketch, size, 0, 0, cv.INTER_LINEAR);

    // Display the image on the canvas
    imageCanvas.width = newWidth;
    imageCanvas.height = newHeight;
    const ctx = imageCanvas.getContext('2d');
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, newWidth, newHeight);
    
    cv.imshow('imageCanvas', resizedSketch);
    
    sketchRGB.delete();
    resizedSketch.delete();
    statusElement.textContent = "Ready. Preview updated.";
}

// --- DOWNLOAD LOGIC (The "Bait Maker" part) ---

function createBaitImage(mode) {
    // Check if processedSketchMat is properly set
    if (!processedSketchMat || processedSketchMat.empty() || processedSketchMat.isDeleted()) return null;

    // --- 1. Prepare the Alpha Channel ---
    let alphaMat = new cv.Mat();
    // This creates an opaque white/black mask, same type as the sketch (CV_8UC1)
    let scalar255 = new cv.Mat(processedSketchMat.rows, processedSketchMat.cols, processedSketchMat.type(), new cv.Scalar(255));
    cv.subtract(scalar255, processedSketchMat, alphaMat);
    scalar255.delete();
    
    // --- 2. Prepare the RGB Channels ---
    let rgbColor;
    if (mode === 'white') {
        // Black sketch: R=0, G=0, B=0, Alpha=255 (Opaque)
        rgbColor = new cv.Scalar(0, 0, 0, 255);
    } else { // mode === 'black'
        // White sketch: R=255, G=255, B=255, Alpha=255 (Opaque)
        rgbColor = new cv.Scalar(255, 255, 255, 255);
    }
    
    // Create a 3-channel (RGB) matrix filled with the chosen color (Black or White)
    // FIX: Pass the explicit cv.Scalar (4 elements) to the constructor
    let rgbMat = new cv.Mat(processedSketchMat.rows, processedSketchMat.cols, cv.CV_8UC3, rgbColor);
    
    // --- 3. Merge RGB and Alpha ---
    let alphaList = new cv.MatVector();
    alphaList.push_back(alphaMat);
    
    let rgbList = new cv.MatVector();
    cv.split(rgbMat, rgbList);

    let channels = new cv.MatVector();
    channels.push_back(rgbList.get(0));
    channels.push_back(rgbList.get(1));
    channels.push_back(rgbList.get(2));
    channels.push_back(alphaList.get(0)); // The calculated Alpha channel

    let rgbaMat = new cv.Mat();
    cv.merge(channels, rgbaMat);

    // Clean up intermediate Mats
    alphaMat.delete();
    rgbMat.delete();
    channels.delete();
    alphaList.delete();
    rgbList.delete();

    return rgbaMat;
}


function saveSketch(mode) {
    // This check now relies on the global processedSketchMat, which is set only 
    // after the image is fully loaded and processed in updatePreview.
    if (!processedSketchMat || processedSketchMat.empty() || processedSketchMat.isDeleted()) {
        statusElement.textContent = "Please select an image and generate a preview first.";
        return;
    }

    const baitMat = createBaitImage(mode);
    if (!baitMat) {
        statusElement.textContent = "Error creating bait image.";
        return;
    }

    // Use a temporary canvas to get the PNG data URL
    const tempCanvas = document.createElement('canvas');
    cv.imshow(tempCanvas, baitMat);

    // Download the canvas content
    // Check if file is selected before accessing fileInput.files[0]
    const baseName = fileInput.files.length > 0 
                     ? fileInput.files[0].name.split('.').slice(0, -1).join('.') 
                     : 'default'; // Fallback name
    const filename = `${baseName}_bait_${mode}.png`;
    
    const dataURL = tempCanvas.toDataURL("image/png");
    const link = document.createElement('a');
    link.href = dataURL;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    baitMat.delete();
    statusElement.textContent = `Successfully saved ${filename}.`;
}

// Initial canvas setup
imageCanvas.width = PREVIEW_MAX_WIDTH;
imageCanvas.height = PREVIEW_MAX_HEIGHT;
const ctx = imageCanvas.getContext('2d');
ctx.fillStyle = 'black';
ctx.fillRect(0, 0, PREVIEW_MAX_WIDTH, PREVIEW_MAX_HEIGHT);
ctx.fillStyle = 'white';
ctx.textAlign = 'center';
ctx.font = '16px sans-serif';
ctx.fillText('Select an image and parameters to start.', PREVIEW_MAX_WIDTH / 2, PREVIEW_MAX_HEIGHT / 2);

