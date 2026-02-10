const { GoogleGenerativeAI } = require("@google/generative-ai");

// Access the key directly or from env if we were in the app context
// hardcoding here for the standalone test script as per user's last provided key
const API_KEY = "AIzaSyBj-033GCRbvuZRvSnsV2KlFzhPFZYoF2g";

async function testGemini() {
    const genAI = new GoogleGenerativeAI(API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = "Explain the technological singularity in one sentence.";

    try {
        console.log("Sending request to Gemini...");
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        console.log("Reuslt:", text);
    } catch (error) {
        console.error("Error testing Gemini:", error);
    }
}

testGemini();
