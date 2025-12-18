// --- APPLY TEXTS TO CANVAS ---
function applyTexts(ctx) {
    textElements.forEach(element => {
        const textInput = document.getElementById(element.textId);
        const xInput = document.getElementById(element.xId);
        const yInput = document.getElementById(element.yId);
        const colorInput = document.getElementById(element.colorId);
        const outlineInput = document.getElementById(element.outlineId);

        // Validate inputs
        const text = textInput?.value || "";
        const x = parseInt(xInput?.value, 10) || 0;
        const y = parseInt(yInput?.value, 10) || 0;
        const color = colorInput?.value || "black";
        const outline = outlineInput?.value || "none";

        if (text) {
            ctx.font = '20px sans-serif';
            ctx.fillStyle = color;
            ctx.fillText(text, x, y);

            if (outline === 'opposite') {
                ctx.strokeStyle = color === 'white' ? 'black' : 'white';
                ctx.lineWidth = 2;
                ctx.strokeText(text, x, y);
            }
        }
    });
}

// --- ADDITIONAL FUNCTION FOR GENERIC TEXT ADD ---
function addText(text, elementId) {
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = text;
        console.log(`Text \"${text}\" added to element with ID \"${elementId}\".`);
    } else {
        console.error(`No element found with ID \"${elementId}\".`);
    }
}

// Example usage
addText('Hello, world!', 'outputDiv');