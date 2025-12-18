// Updated script.js to improve and fix text adding functionality
function addText(text, elementId) {
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = text;
        console.log(`Text "${text}" added to element with ID "${elementId}".`);
    } else {
        console.error(`No element found with ID "${elementId}".`);
    }
}

// Example usage
addText('Hello, world!', 'outputDiv');